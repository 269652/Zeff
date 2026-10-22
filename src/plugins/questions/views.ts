import { ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { allows, refLabels, sourceLabel } from "@/lib/boundaries";
import { isInstalled } from "@/plugins/state";
import type { QueryGroup, QueryResultView, QueryRow } from "./shared";

/**
 * Structured questions' query layer: a registry of named read-only views over Zeff's own data (time entries, bank
 * transactions, calendar events, todos, messages, Workspace databases …). A view says what it holds for the AI — its
 * description, its typed filters, what it can be grouped by and what it can add up — and reads its items itself, with
 * the filters bound as values (never SQL from outside). A query names a view, filters, a grouping and an aggregation as
 * JSON; it is checked against the view here before anything runs, and the aggregation over the items is done here too,
 * the same for every view. Other plugins add views through the point `questionViews` (view-point.ts — the timeline does), or
 * with registerView. Server only.
 */

export type { QueryContext, Aggregate, FilterType, FilterSpec, Item, Condition, Filters, QueryView, Query } from "./view-types";
export { AGGREGATES, TIME_DIMS, clearanceOf, has, hasAny } from "./view-types";
import { AGGREGATES, TIME_DIMS, clearanceOf, type Aggregate, type Condition, type Filters, type Item, type Query, type QueryContext, type QueryView } from "./view-types";
import { BUILTIN_VIEWS } from "./builtin-views";
import { questionViews } from "./view-point";
import "@/plugins/contributions";

// ---------------------------------------------------------------------------
// Sensitivity
// ---------------------------------------------------------------------------

/** The views that read one source as a whole: they follow its label (the others go by their items' labels). */
const VIEW_SOURCES: Record<string, string> = { time_entries: "time", bank_transactions: "bank", todos: "todos", calendar_events: "calendar" };

/**
 * The sensitivity hook as a predicate for one batch (one reader, one run): a view by the source it reads, an item by its
 * ref's label — a page's by its databases', a mail's or message's by its source's (WhatsApp, Signal: personal by default),
 * a time entry's, a transaction's, a todo's by theirs; other refs (the timeline's own, a test's) are open. The same rules
 * as the MCP guard: secret for nobody, personal for you and agents allowed personal data.
 */
export function sensitivityGate(context: QueryContext): (viewName: string, ref?: string) => boolean {
  const clearance = clearanceOf(context);
  const labelOf = refLabels();
  return (viewName, ref) => {
    const source = VIEW_SOURCES[viewName];
    if (source && !allows(clearance, sourceLabel(source))) return false;
    return !ref || allows(clearance, labelOf(ref));
  };
}

/**
 * THE SENSITIVITY HOOK — whether `context` may see a view (`ref` unset) or one of its items (`ref`: entry:12, page:4,
 * mail:… — the shared entity refs). Asked for every view offered and run, and for every item before it is counted or
 * shown: the data boundaries' labels (open / personal / secret) against the caller's clearance (see sensitivityGate).
 */
export function allowedFor(viewName: string, context: QueryContext, ref?: string): boolean {
  return sensitivityGate(context)(viewName, ref);
}

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

const g = globalThis as typeof globalThis & { __zeffQueryViews?: Map<string, QueryView> };
const registry = (g.__zeffQueryViews ??= new Map());
for (const v of BUILTIN_VIEWS) if (!registry.has(v.name)) registry.set(v.name, v);

/** A view added (or replaced by its name) — the timeline's, say, from its plugin's server.ts. */
export function registerView(view: QueryView): void {
  registry.set(view.name, view);
}

/** The views `ctx` may ask, their plugins installed. */
export function listViews(ctx: QueryContext): QueryView[] {
  const allowed = sensitivityGate(ctx);
  const byName = new Map<string, QueryView>(registry);
  for (const c of questionViews.list()) for (const v of c.impl) if (!byName.has(v.name)) byName.set(v.name, v);
  return [...byName.values()].filter((v) => (!v.plugin || isInstalled(v.plugin)) && allowed(v.name));
}

// ---------------------------------------------------------------------------
// Checking a query
// ---------------------------------------------------------------------------

const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** "2026" / "2026-10" / "2026-10-05" → a day; the start or the end of the year or month. Null: not a date. */
export function dayOf(raw: string, end: boolean): string | null {
  const s = raw.trim();
  let m = /^(\d{4})$/.exec(s);
  if (m) return end ? `${m[1]}-12-31` : `${m[1]}-01-01`;
  m = /^(\d{4})-(\d{2})$/.exec(s);
  if (m && +m[2] >= 1 && +m[2] <= 12) return end ? `${m[1]}-${m[2]}-${String(lastDay(+m[1], +m[2])).padStart(2, "0")}` : `${m[1]}-${m[2]}-01`;
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= lastDay(+m[1], +m[2])) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

const OPS: Condition["op"][] = ["contains", "is", "is_not", "gt", "lt", "gte", "lte", "empty", "not_empty"];

/** The filters as the AI sends them — an object, or a list of { name, value | values | prop/op } — as one object. */
function filterPairs(raw: unknown): [string, unknown][] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    const out = new Map<string, unknown>();
    for (const f of raw as Record<string, unknown>[]) {
      if (!f || typeof f !== "object") continue;
      const name = String(f.name ?? "");
      if (name === "where" || (f.prop !== undefined && !("values" in f) && name !== "")) {
        if (f.prop !== undefined) out.set("where", [...((out.get("where") as unknown[]) ?? []), { prop: f.prop, op: f.op, value: f.value }]);
        else out.set(name, f.value);
        continue;
      }
      out.set(name, Array.isArray(f.values) && f.values.length ? f.values : f.value);
    }
    return [...out];
  }
  return typeof raw === "object" ? Object.entries(raw as Record<string, unknown>) : [];
}

/** A query as the AI (or an agent) sent it, checked against its view: the normalized query, or what is wrong (naming what is allowed). */
export function validateQuery(raw: unknown, ctx: QueryContext): { ok: true; query: Query; view: QueryView } | { ok: false; error: string } {
  const views = listViews(ctx);
  const r = (raw ?? {}) as Record<string, unknown>;
  const view = views.find((v) => v.name === r.view);
  if (!view) return { ok: false, error: `Unknown view "${String(r.view ?? "")}" — the views: ${views.map((v) => v.name).join(", ")}.` };
  const aggregate = String(r.aggregate ?? "count") as Aggregate;
  if (!AGGREGATES.includes(aggregate)) return { ok: false, error: `Unknown aggregate "${aggregate}" — one of: ${AGGREGATES.join(", ")}.` };
  const measures = Object.keys(view.measures);
  let measure = r.measure == null || r.measure === "" ? undefined : String(r.measure);
  if (measure && !view.dynamic && !measures.includes(measure)) return { ok: false, error: `View ${view.name} has no measure "${measure}" — its measures: ${measures.join(", ") || "none (count only)"}.` };
  if (["sum", "avg", "min", "max"].includes(aggregate) && !measure) {
    measure = measures[0];
    if (!measure && !view.dynamic) return { ok: false, error: `View ${view.name} has nothing to ${aggregate} — count only.` };
  }
  const groupBy = r.groupBy == null || r.groupBy === "" ? undefined : String(r.groupBy);
  if (groupBy && !view.dynamic && !(TIME_DIMS as readonly string[]).includes(groupBy) && !view.dims.includes(groupBy)) return { ok: false, error: `View ${view.name} can't be grouped by "${groupBy}" — by: ${[...view.dims, ...TIME_DIMS].join(", ")}.` };
  const filters: Filters = {};
  for (const [name, value] of filterPairs(r.filters)) {
    if (value === undefined || value === null || value === "") continue;
    const spec = view.filters[name];
    if (!spec) return { ok: false, error: `View ${view.name} has no filter "${name}" — its filters: ${Object.keys(view.filters).join(", ")}.` };
    const bad = (why: string) => ({ ok: false as const, error: `Filter ${name} of ${view.name}: ${why}` });
    switch (spec.type) {
      case "date": {
        const d = dayOf(String(value), name === "to" || name.endsWith("To") || name === "until");
        if (!d) return bad(`"${String(value)}" is not a date (YYYY-MM-DD, YYYY-MM or YYYY).`);
        filters[name] = d;
        break;
      }
      case "text":
        filters[name] = String(value).slice(0, 200);
        break;
      case "texts": {
        const list = (Array.isArray(value) ? value : String(value).split("|")).map((x) => String(x).trim()).filter(Boolean).slice(0, 30);
        if (!list.length) continue;
        filters[name] = list;
        break;
      }
      case "number": {
        const n = Number(value);
        if (!Number.isFinite(n)) return bad(`"${String(value)}" is not a number.`);
        filters[name] = n;
        break;
      }
      case "enum": {
        const v = String(value);
        if (!spec.values?.includes(v)) return bad(`"${v}" is not one of ${spec.values?.join(", ")}.`);
        filters[name] = v;
        break;
      }
      case "boolean":
        filters[name] = value === true || value === "true" || value === 1 || value === "1";
        break;
      case "conditions": {
        const list = (Array.isArray(value) ? value : [value]) as Record<string, unknown>[];
        const conds: Condition[] = [];
        for (const c of list) {
          const op = String(c?.op ?? "contains") as Condition["op"];
          if (!c?.prop || !OPS.includes(op)) return bad(`each condition needs a prop and an op (${OPS.join(", ")}).`);
          conds.push({ prop: String(c.prop), op, ...(c.value !== undefined ? { value: String(c.value) } : {}) });
        }
        filters[name] = conds;
        break;
      }
    }
  }
  for (const [name, spec] of Object.entries(view.filters)) if (spec.required && filters[name] === undefined) return { ok: false, error: `View ${view.name} needs the filter "${name}" (${spec.description}).` };
  const order = r.order === "asc" ? "asc" : "desc";
  const limit = Math.max(1, Math.min(200, Math.round(Number(r.limit) || 50)));
  return { ok: true, view, query: { view: view.name, filters, ...(groupBy ? { groupBy } : {}), aggregate, ...(measure ? { measure } : {}), order, limit } };
}

// ---------------------------------------------------------------------------
// Running one
// ---------------------------------------------------------------------------

const WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

/** The ISO week of a day: "2026-W43". */
function isoWeek(day: string): string {
  const d = new Date(`${day.slice(0, 10)}T00:00:00Z`);
  const wd = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - wd + 3);
  const y = d.getUTCFullYear();
  const first = new Date(Date.UTC(y, 0, 4));
  const n = 1 + Math.round(((d.getTime() - first.getTime()) / 864e5 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
  return `${y}-W${String(n).padStart(2, "0")}`;
}

function dimOf(item: Item, dim: string): string {
  const day = item.at.slice(0, 10);
  switch (dim) {
    case "day":
      return day;
    case "week":
      return isoWeek(day);
    case "month":
      return day.slice(0, 7);
    case "year":
      return day.slice(0, 4);
    case "weekday":
      return WEEKDAYS[new Date(`${day}T00:00:00Z`).getUTCDay()] ?? "";
    default:
      return item.dims[dim] ?? "";
  }
}

const round = (n: number) => Math.round(n * 100) / 100;

/** One aggregate over items: a number (count, sum …), a time (first, last) or null (nothing to take it of). */
function aggregateOf(items: Item[], agg: Aggregate, measure?: string): number | string | null {
  const nums = () => items.map((i) => i.values[measure ?? ""]).filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  switch (agg) {
    case "count":
    case "list":
      return items.length;
    case "count_days":
      return new Set(items.map((i) => i.at.slice(0, 10))).size;
    case "sum":
      return round(nums().reduce((s, n) => s + n, 0));
    case "avg": {
      const n = nums();
      return n.length ? round(n.reduce((s, x) => s + x, 0) / n.length) : null;
    }
    case "min": {
      const n = nums();
      return n.length ? Math.min(...n) : null;
    }
    case "max": {
      const n = nums();
      return n.length ? Math.max(...n) : null;
    }
    case "first":
      return items.reduce<string | null>((m, i) => (m === null || i.at < m ? i.at : m), null);
    case "last":
      return items.reduce<string | null>((m, i) => (m === null || i.at > m ? i.at : m), null);
  }
}

/** The query in one line, for "how it was computed" under the answer. */
export function explainQuery(q: Query, rows: number): string {
  const f = Object.entries(q.filters).map(([k, v]) => `${k} = ${Array.isArray(v) ? v.map((x) => (typeof x === "object" ? `${x.prop} ${x.op} ${x.value ?? ""}`.trim() : x)).join(" | ") : String(v)}`);
  const what = `${q.aggregate}${q.measure ? `(${q.measure})` : ""}`;
  return [q.view, f.length ? f.join(", ") : t("no filters"), q.groupBy ? `${what} ${t("by")} ${q.groupBy}` : what, t("{n} rows", { n: rows })].join(" · ");
}

/** Rows shown (and cited) at most per query. */
const MAX_ROWS = 30;

/**
 * A query run: checked, the view's items read (each passing the sensitivity hook), aggregated — in total and per group
 * (the biggest first, or the earliest for first/last asc) — with the rows behind it (those of the top groups first;
 * min/max: the row it is; first/last: the earliest/latest).
 */
export async function runQuery(raw: unknown, ctx: QueryContext): Promise<QueryResultView> {
  const v = validateQuery(raw, ctx);
  if (!v.ok) throw new ValidationError(v.error);
  const { query: q, view } = v;
  const allowed = sensitivityGate(ctx);
  const items = (await view.items(q.filters, ctx)).filter((i) => allowed(view.name, i.ref));
  if (view.dynamic) {
    const known = new Set([...view.dims, ...items.flatMap((i) => Object.keys(i.dims))]);
    const nums = new Set([...Object.keys(view.measures), ...items.flatMap((i) => Object.keys(i.values))]);
    if (q.groupBy && !(TIME_DIMS as readonly string[]).includes(q.groupBy) && !known.has(q.groupBy)) throw new ValidationError(`No property "${q.groupBy}" to group by — the properties: ${[...known].join(", ")}.`);
    if (q.measure && !nums.has(q.measure)) throw new ValidationError(`No number property "${q.measure}" — the number properties: ${[...nums].join(", ") || "none"}.`);
  }
  const total = { count: items.length, value: aggregateOf(items, q.aggregate, q.measure) };
  let groups: QueryGroup[] = [];
  if (q.groupBy) {
    const by = new Map<string, Item[]>();
    for (const i of items) {
      const k = dimOf(i, q.groupBy);
      by.set(k, [...(by.get(k) ?? []), i]);
    }
    groups = [...by].map(([key, list]) => ({ key: key || "—", value: aggregateOf(list, q.aggregate, q.measure), count: list.length }));
    const cmp = (a: QueryGroup, b: QueryGroup) => {
      const x = a.value ?? "";
      const y = b.value ?? "";
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return q.order === "asc" ? c : -c;
    };
    groups.sort((a, b) => cmp(a, b) || a.key.localeCompare(b.key));
  }
  const shownGroups = groups.slice(0, q.limit);
  // The rows behind it: of the groups shown in their order, the latest first; min/max: that row first.
  const rank = new Map(shownGroups.map((g, i) => [g.key, i]));
  let picked = [...items].sort((a, b) => b.at.localeCompare(a.at));
  if (q.groupBy) picked = picked.filter((i) => rank.has(dimOf(i, q.groupBy!) || "—")).sort((a, b) => rank.get(dimOf(a, q.groupBy!) || "—")! - rank.get(dimOf(b, q.groupBy!) || "—")! || b.at.localeCompare(a.at));
  if ((q.aggregate === "min" || q.aggregate === "max") && q.measure) picked.sort((a, b) => ((a.values[q.measure!] ?? 0) - (b.values[q.measure!] ?? 0)) * (q.aggregate === "max" ? -1 : 1));
  if (q.aggregate === "first") picked.sort((a, b) => a.at.localeCompare(b.at));
  const rows: QueryRow[] = picked.slice(0, Math.min(MAX_ROWS, q.aggregate === "list" ? q.limit : MAX_ROWS)).map((i) => ({ at: i.at, title: i.title, ref: i.ref, href: i.href ?? null, ...(q.measure && i.values[q.measure] !== undefined ? { value: i.values[q.measure] } : {}), ...(q.groupBy ? { group: dimOf(i, q.groupBy) || "—" } : {}) }));
  return { query: q, explain: explainQuery(q, items.length), total, groups: shownGroups, groupsTotal: groups.length, rows };
}
