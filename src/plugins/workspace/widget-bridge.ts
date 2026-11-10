/**
 * The server's side of a widget's calls (lib/widgets/bridge.ts): what a widget — a small program an AI wrote, shown in a
 * sandbox on a page, in the assistant's answer, in a lesson — may read and change of the Workspace. Checked again here,
 * whatever the page in between let through:
 *
 *   read   any database that isn't secret (the boundaries): its fields, its rows (values by field name)
 *   write  a row added or changed — only in a database the user allowed this widget's code (grantWidget, by widgetKey)
 *   ai     a question to the AI — only when allowed, AI_PER_HOUR an hour per widget
 *
 * Grants are the user's: the AI can ask for them (a widget's `writes`, `ai`), never give them. Server only.
 */
import { mayRead } from "@/lib/boundaries";
import { getPref, setPref } from "@/lib/prefs";
import { CALL_METHODS, MAX_STATE, type CallName, type WidgetGrant } from "@/lib/widgets/bridge";
import { CREATED, UPDATED, cellText, isComputed, sortRows, TITLE, type DbSchema, type Property, type Row } from "./model";
import { pageLabel } from "./sensitivity";
import * as store from "./store";

const PREF = "widgets.grants";
/** The most grants kept (the oldest go first). */
const MAX_GRANTS = 500;
/** How many AI questions a widget may ask an hour. */
export const AI_PER_HOUR = 20;
/** The most rows a widget reads at once. */
const MAX_ROWS = 200;

type Kept = WidgetGrant & { at: string; title?: string };

const all = (): Record<string, Kept> => getPref<Record<string, Kept>>(PREF, {});

/** What the user allowed the widget with this key (null: nothing yet). */
export function widgetGrant(key: string): WidgetGrant | null {
  const g = all()[key];
  return g ? { dbs: g.dbs ?? [], ...(g.ai ? { ai: true } : {}) } : null;
}

/** The user allows this widget's code to write to these databases (and to ask the AI) — added to what it may already. */
export function grantWidget(key: string, add: WidgetGrant, title?: string): WidgetGrant {
  if (!/^w[0-9a-f]{14}$/.test(key)) throw new Error("Not a widget.");
  const dbs = add.dbs.filter((id) => !!store.getDatabase(id));
  const had = all();
  const cur = had[key];
  const next: Kept = { dbs: [...new Set([...(cur?.dbs ?? []), ...dbs])], ...(add.ai || cur?.ai ? { ai: true } : {}), at: new Date().toISOString(), ...(title || cur?.title ? { title: (title || cur?.title || "").slice(0, 80) } : {}) };
  const entries = Object.entries({ ...had, [key]: next }).sort((a, b) => b[1].at.localeCompare(a[1].at)).slice(0, MAX_GRANTS);
  setPref(PREF, Object.fromEntries(entries));
  return widgetGrant(key)!;
}

/** Takes back what a widget was allowed (a database, or the AI; nothing named: all of it). */
export function revokeWidget(key: string, what?: { db?: number; ai?: boolean }): WidgetGrant | null {
  const had = all();
  const cur = had[key];
  if (!cur) return null;
  if (!what || (what.db === undefined && !what.ai)) delete had[key];
  else had[key] = { ...cur, dbs: cur.dbs.filter((d) => d !== what.db), ...(what.ai ? { ai: undefined } : {}) };
  setPref(PREF, had);
  return widgetGrant(key);
}

class Refused extends Error {}

/** The database a widget names: its id, or its title (exactly, any case) — not one that is secret, archived or gone. */
function databaseOf(ref: unknown): { page: store.Page; schema: DbSchema } {
  const raw = typeof ref === "string" ? ref.trim() : ref;
  let id = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : 0;
  if (!id && typeof raw === "string" && raw) {
    const want = raw.toLowerCase();
    id = store.tree().find((x) => x.kind === "database" && (x.title || "").trim().toLowerCase() === want)?.id ?? 0;
  }
  const d = id ? store.getDatabase(id) : null;
  if (!d || d.page.archivedAt) throw new Refused(`No database "${String(ref)}".`);
  if (!mayRead(pageLabel(d.page.id))) throw new Refused(`"${d.page.title || "Untitled"}" is secret — widgets can't read it.`);
  return d;
}

/** A field by name (or the title's name, or "title"; "Created" / "Edited"). */
function fieldOf(schema: DbSchema, name: unknown): string | null {
  const n = String(name ?? "").trim().toLowerCase();
  if (!n) return null;
  if (n === "title" || n === schema.titleName.toLowerCase()) return TITLE;
  if (n === "created" || n === "created_at") return CREATED;
  if (n === "edited" || n === "updated" || n === "updated_at") return UPDATED;
  return schema.properties.find((p) => p.name.toLowerCase() === n)?.id ?? null;
}

/** A cell as a widget reads it: numbers and ticks as they are, a choice by its name, several as a list, the rest as text. */
function plain(p: Property, v: unknown, labels: ReturnType<typeof store.labelFns>): unknown {
  if (v === null || v === undefined || v === "") return p.type === "checkbox" ? false : null;
  if (p.type === "number") return typeof v === "number" ? v : Number(v);
  if (p.type === "checkbox") return !!v;
  if (p.type === "multi_select" || p.type === "person" || (p.type === "relation" && p.relationSource === undefined)) {
    const text = cellText(p, v, labels);
    return text ? text.split(", ") : [];
  }
  return cellText(p, v, labels);
}

const fieldsOf = (schema: DbSchema) =>
  schema.properties
    .filter((p) => !["srcref", "srcedited", "srcurl", "ticketkey", "noteref"].includes(p.id))
    .map((p) => ({ name: p.name, type: p.type, ...(p.options?.length ? { options: p.options.map((o) => o.name) } : {}), ...(isComputed(p) ? { computed: true } : {}) }));

async function readRows(args: Record<string, unknown>) {
  const d = databaseOf(args.db);
  const data = store.rowsOf(d.page.id);
  if (!data) throw new Refused("No rows.");
  const props = fieldsOf(data.schema).map((f) => data.schema.properties.find((p) => p.name === f.name)!);
  const labels = store.labelFns(await store.labelsFor(data.schema, data.rows));
  const valuesOf = (r: Row) => Object.fromEntries(props.map((p) => [p.name, plain(p, r.cells[p.id], labels)]));
  let rows = data.rows.map((r) => ({ r, values: valuesOf(r) }));
  // where: { Field: value } — equal (as text, any case), a list: one of them; a list field holds it.
  if (args.where && typeof args.where === "object" && !Array.isArray(args.where)) {
    for (const [name, want] of Object.entries(args.where as Record<string, unknown>)) {
      const id = fieldOf(data.schema, name);
      if (!id) throw new Refused(`No field "${name}" in "${d.page.title}".`);
      const wanted = (Array.isArray(want) ? want : [want]).map((x) => String(x ?? "").toLowerCase());
      const prop = data.schema.properties.find((p) => p.id === id);
      rows = rows.filter(({ r, values }) => {
        const v = id === TITLE ? r.title : prop ? values[prop.name] : id === CREATED ? r.createdAt : r.updatedAt;
        const have = (Array.isArray(v) ? v : [v]).map((x) => String(x ?? "").toLowerCase());
        return have.some((h) => wanted.includes(h)) || (!have.length && wanted.includes(""));
      });
    }
  }
  if (typeof args.contains === "string" && args.contains.trim()) {
    const w = args.contains.trim().toLowerCase();
    rows = rows.filter(({ r, values }) => r.title.toLowerCase().includes(w) || Object.values(values).some((v) => String(Array.isArray(v) ? v.join(" ") : (v ?? "")).toLowerCase().includes(w)));
  }
  if (args.sort !== undefined) {
    const id = fieldOf(data.schema, args.sort);
    if (!id) throw new Refused(`No field "${String(args.sort)}" to sort by.`);
    const order = sortRows(rows.map((x) => x.r), [{ prop: id, dir: args.desc ? "desc" : "asc" }], data.schema.properties).map((r) => r.id);
    const at = new Map(order.map((id, i) => [id, i]));
    rows.sort((a, b) => at.get(a.r.id)! - at.get(b.r.id)!);
  }
  const limit = Math.max(1, Math.min(MAX_ROWS, Math.floor(Number(args.limit)) || 100));
  return { db: d.page.id, title: d.page.title, titleName: data.schema.titleName, total: rows.length, rows: rows.slice(0, limit).map(({ r, values }) => ({ id: r.id, title: r.title, values, created: r.createdAt, edited: r.updatedAt })) };
}

/** Values by field name → cells; the title (by its name or "title") apart. */
async function cellsOf(schema: DbSchema, values: unknown): Promise<{ title?: string; cells: Record<string, unknown>; schema: DbSchema; notes: string[] }> {
  if (!values || typeof values !== "object" || Array.isArray(values)) throw new Refused("values: { Field: value }");
  const rest: Record<string, unknown> = {};
  let title: string | undefined;
  for (const [k, v] of Object.entries(values as Record<string, unknown>)) {
    if (fieldOf(schema, k) === TITLE) title = String(v ?? "").slice(0, 300);
    else rest[k] = typeof v === "number" || typeof v === "boolean" || v === null ? v : Array.isArray(v) ? v.map((x) => String(x).slice(0, 300)) : String(v ?? "").slice(0, 20000);
  }
  const { valuesToCells } = await import("./mcp-db");
  const c = await valuesToCells(schema, rest);
  return { title, ...c };
}

function mayWrite(key: string, dbId: number, title: string): void {
  if (!widgetGrant(key)?.dbs.includes(dbId)) throw new Refused(`Not allowed: this widget may not write to "${title || "Untitled"}" — the user can allow it on the widget.`);
}

const asked = new Map<string, number[]>();

/** A question to the AI from a widget (allowed, and not too many). */
async function askAi(key: string, args: Record<string, unknown>) {
  if (!widgetGrant(key)?.ai) throw new Refused("Not allowed: this widget may not ask the AI — the user can allow it on the widget.");
  const now = Date.now();
  const recent = (asked.get(key) ?? []).filter((t) => now - t < 3600_000);
  if (recent.length >= AI_PER_HOUR) throw new Refused(`Enough for now: ${AI_PER_HOUR} questions an hour.`);
  asked.set(key, [...recent, now]);
  const prompt = String(args.prompt ?? "").trim().slice(0, 20000);
  if (!prompt) throw new Refused("prompt: what to ask");
  const schema = args.schema && typeof args.schema === "object" && !Array.isArray(args.schema) ? (args.schema as object) : null;
  const { runAi } = await import("@/lib/ai");
  const r = await runAi<Record<string, unknown>>(
    `Ein kleines Programm (ein Widget auf einer Seite) fragt dich. Antworte knapp und nur darauf.\n\n${prompt}`,
    schema ?? { type: "object", required: ["text"], properties: { text: { type: "string" } } },
    { task: "widget-ai", timeoutMs: 2 * 60000, maxBudgetUsd: 0.2, urgent: true },
  );
  if (!r.output) throw new Refused("The AI gave no answer.");
  return r.output;
}

/**
 * A widget's call, done — or refused with a message the widget shows (thrown). `key`: the widget's key (its code's hash;
 * what the user granted is kept by it). The page answers state, toast and open itself.
 */
export async function widgetCall(key: string, method: CallName, args: Record<string, unknown>): Promise<unknown> {
  const need = CALL_METHODS[method]?.need;
  if (!need || need === "host") throw new Refused(`"${method}" is the page's.`);
  switch (method) {
    case "db.list":
      return store
        .tree()
        .filter((x) => x.kind === "database" && mayRead(pageLabel(x.id)))
        .map((x) => ({ id: x.id, title: x.title || "Untitled", rows: store.rowsOf(x.id)?.rows.length ?? 0 }));
    case "db.schema": {
      const d = databaseOf(args.db);
      return { id: d.page.id, title: d.page.title, titleName: d.schema.titleName, fields: fieldsOf(d.schema) };
    }
    case "db.rows":
      return readRows(args);
    case "db.add": {
      const d = databaseOf(args.db);
      mayWrite(key, d.page.id, d.page.title);
      const c = await cellsOf(d.schema, args.values);
      if (c.schema !== d.schema) store.updateSchema(d.page.id, c.schema);
      const id = store.addRow(d.page.id, { title: c.title ?? "", cells: c.cells });
      await (await import("./pipeline")).syncAfterEdit(id).catch(() => null);
      return { id, ...(c.notes.length ? { ignored: c.notes } : {}) };
    }
    case "db.update": {
      const d = databaseOf(args.db);
      mayWrite(key, d.page.id, d.page.title);
      const row = store.getPage(Math.floor(Number(args.row)));
      if (!row || row.dbId !== d.page.id || row.archivedAt) throw new Refused(`No row ${String(args.row)} in "${d.page.title}".`);
      const c = await cellsOf(d.schema, args.values);
      if (c.schema !== d.schema) store.updateSchema(d.page.id, c.schema);
      for (const [k, v] of Object.entries(c.cells)) store.setCell(row.id, k, v);
      if (c.title !== undefined) store.updatePage(row.id, { title: c.title });
      await (await import("./pipeline")).syncAfterEdit(row.id).catch(() => null);
      return { id: row.id, ...(c.notes.length ? { ignored: c.notes } : {}) };
    }
    case "ai":
      return askAi(key, args);
  }
  throw new Refused(`Unknown call "${String(method)}".`);
}

/** Whether a widget's state may be kept: JSON, MAX_STATE characters at most. */
export function stateOk(value: unknown): string | null {
  try {
    const s = JSON.stringify(value ?? null);
    return s.length <= MAX_STATE ? s : null;
  } catch {
    return null;
  }
}

/** What a widget is told of where it is (zeff.context): its page, and the databases — those shown on its page first. */
export function widgetContext(pageId?: number | null): { page?: { id: number; title: string }; databases: { id: number; title: string }[] } {
  const p = pageId ? store.getPage(pageId) : null;
  const all = store.tree().filter((x) => x.kind === "database" && mayRead(pageLabel(x.id)));
  const here = new Set<number>();
  if (p) {
    if (p.kind === "database") here.add(p.id);
    if (p.dbId) here.add(p.dbId);
    const walk = (nodes: { type: string; attrs?: Record<string, unknown>; content?: unknown[] }[]) => {
      for (const n of nodes) {
        if (n.type === "databaseView" && Number(n.attrs?.dbId) > 0) here.add(Number(n.attrs!.dbId));
        if (Array.isArray(n.content)) walk(n.content as never);
      }
    };
    walk((p.content?.content ?? []) as never);
  }
  const first = all.filter((x) => here.has(x.id));
  const rest = all.filter((x) => !here.has(x.id)).slice(0, 40);
  return { ...(p ? { page: { id: p.id, title: p.title || "Untitled" } } : {}), databases: [...first, ...rest].map((x) => ({ id: x.id, title: x.title || "Untitled", ...(here.has(x.id) ? { onPage: true } : {}) })) };
}

/** Whether an error is a refusal to tell the widget (else: something broke — told plainly too, but logged). */
export const isRefusal = (e: unknown): boolean => e instanceof Refused;
