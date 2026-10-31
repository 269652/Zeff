import { localDay } from "@/lib/dates";
import { type Property, type Row, TITLE, CREATED, UPDATED, propById, type Sort, type PropType, type Cond, type Rule, type Filter, isFilter } from "./schema";
import { isEmptyValue, dateRange, asArray, type Labels, noLabels, cellText } from "./values";

/** The value of a cell for sorting and grouping: a number, a string, or null (empty). */
function sortKey(p: Property | undefined, v: unknown, row: Row): number | string | null {
  if (!p) return null;
  if (p.type === "created_time") return row.createdAt;
  if (p.type === "updated_time") return row.updatedAt;
  if (isEmptyValue(p, v)) return null;
  switch (p.type) {
    case "number":
    case "rollup":
    case "formula":
      return typeof v === "number" ? v : typeof v === "string" ? v : typeof v === "boolean" ? Number(v) : Array.isArray(v) ? v.length : null;
    case "checkbox":
      return v ? 1 : 0;
    case "date":
      return dateRange(v)?.start ?? null;
    case "select":
    case "status": {
      const i = p.options?.findIndex((o) => o.id === v) ?? -1;
      return i >= 0 ? i : null;
    }
    case "multi_select": {
      const i = p.options?.findIndex((o) => o.id === asArray(v)[0]) ?? -1;
      return i >= 0 ? i : null;
    }
    case "person":
    case "relation":
    case "todo":
      return asArray(v).length;
    default:
      return String(v).toLowerCase();
  }
}

const virtual = (id: string): Property | undefined =>
  id === TITLE ? { id, name: "Title", type: "text" } : id === CREATED ? { id, name: "Created", type: "created_time" } : id === UPDATED ? { id, name: "Edited", type: "updated_time" } : undefined;
export const propOrVirtual = (props: Property[], id: string) => propById(props, id) ?? virtual(id);
export const cellOf = (row: Row, id: string): unknown => (id === TITLE ? row.title : id === CREATED ? row.createdAt : id === UPDATED ? row.updatedAt : row.cells[id]);

export function sortRows(rows: Row[], sorts: Sort[], props: Property[]): Row[] {
  const active = sorts.filter((s) => propOrVirtual(props, s.prop));
  if (!active.length) return rows;
  return [...rows].sort((a, b) => {
    for (const s of active) {
      const p = propOrVirtual(props, s.prop)!;
      const x = sortKey(p, cellOf(a, s.prop), a);
      const y = sortKey(p, cellOf(b, s.prop), b);
      // Empty ones last, whatever the direction.
      if (x === null || y === null) {
        if (x === y) continue;
        return x === null ? 1 : -1;
      }
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
      if (c) return s.dir === "desc" ? -c : c;
    }
    return a.id - b.id;
  });
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
/** Monday of the week of d. */
const weekStart = (d: Date) => addDays(startOfDay(d), -((d.getDay() + 6) % 7));

/** The condition choices of a property type — what the filter menu offers. */
export function condsFor(type: PropType | "title"): Cond[] {
  switch (type) {
    case "number":
    case "rollup":
    case "formula":
      return ["eq", "neq", "gt", "lt", "gte", "lte", "is_empty", "not_empty"];
    case "select":
    case "status":
      return ["is", "is_not", "is_empty", "not_empty"];
    case "multi_select":
    case "person":
    case "relation":
    case "todo":
    case "ticket":
      return ["contains", "not_contains", "is_empty", "not_empty"];
    case "date":
    case "created_time":
    case "updated_time":
      return ["is", "before", "after", "on_or_before", "on_or_after", "today", "this_week", "this_month", "last_month", "this_year", "past_week", "past_month", "next_week", "next_month", "is_empty", "not_empty"];
    case "checkbox":
      return ["checked", "unchecked"];
    default:
      return ["contains", "not_contains", "is", "is_not", "starts_with", "ends_with", "is_empty", "not_empty"];
  }
}

export const needsValue = (c: Cond): boolean => !["is_empty", "not_empty", "checked", "unchecked", "past_week", "past_month", "next_week", "next_month", "this_week", "this_month", "last_month", "this_year", "today"].includes(c);

export function matchRule(row: Row, rule: Rule, props: Property[], labels: Labels = noLabels): boolean {
  const p = propOrVirtual(props, rule.prop);
  if (!p) return true;
  const v = cellOf(row, rule.prop);
  const cond = rule.cond;
  const empty = p.type === "created_time" || p.type === "updated_time" ? false : isEmptyValue(p, v);
  if (cond === "is_empty") return empty;
  if (cond === "not_empty") return !empty;
  if (cond === "checked") return !!v;
  if (cond === "unchecked") return !v;
  const want = rule.value;
  switch (p.type) {
    case "number":
    case "rollup":
    case "formula": {
      if (typeof v !== "number" && typeof want !== "string" && typeof want !== "number") return false;
      const a = typeof v === "number" ? v : Number(v);
      const b = Number(want);
      if (Number.isNaN(a) || Number.isNaN(b) || want === "" || want === undefined) return p.type === "formula" || p.type === "rollup" ? matchText(cellText(p, v, labels), cond, String(want ?? "")) : false;
      return cond === "eq" ? a === b : cond === "neq" ? a !== b : cond === "gt" ? a > b : cond === "lt" ? a < b : cond === "gte" ? a >= b : cond === "lte" ? a <= b : true;
    }
    case "select":
    case "status":
      return cond === "is" ? v === want : cond === "is_not" ? v !== want : true;
    case "multi_select":
    case "person":
    case "relation":
    case "todo":
    case "ticket": {
      const has = asArray(v).some((x) => x === want || String(x) === String(want));
      return cond === "contains" ? has : cond === "not_contains" ? !has : true;
    }
    case "date":
    case "created_time":
    case "updated_time":
      return matchDate(p.type === "date" ? dateRange(v) : { start: String(p.type === "created_time" ? row.createdAt : row.updatedAt) }, cond, want, labels.now ?? new Date());
    case "checkbox":
      return true;
    default:
      return matchText(rule.prop === TITLE ? row.title : cellText(p, v, labels), cond, String(want ?? ""));
  }
}

function matchText(text: string, cond: Cond, want: string): boolean {
  const t = text.toLowerCase();
  const w = want.toLowerCase();
  switch (cond) {
    case "contains":
      return t.includes(w);
    case "not_contains":
      return !t.includes(w);
    case "is":
      return t === w;
    case "is_not":
      return t !== w;
    case "starts_with":
      return t.startsWith(w);
    case "ends_with":
      return t.endsWith(w);
    default:
      return true;
  }
}

function matchDate(r: { start: string; end?: string } | null, cond: Cond, want: unknown, now: Date): boolean {
  if (!r) return false;
  const start = r.start.slice(0, 10);
  const end = (r.end ?? r.start).slice(0, 10);
  const today = startOfDay(now);
  const within = (from: Date, to: Date) => end >= localDay(from) && start <= localDay(to);
  const w = typeof want === "string" ? want.slice(0, 10) : "";
  switch (cond) {
    case "is":
      return !!w && start <= w && w <= end;
    case "before":
      return !!w && start < w;
    case "after":
      return !!w && end > w;
    case "on_or_before":
      return !!w && start <= w;
    case "on_or_after":
      return !!w && end >= w;
    case "today":
      return within(today, today);
    case "this_week":
      return within(weekStart(today), addDays(weekStart(today), 6));
    case "this_month":
      return within(new Date(today.getFullYear(), today.getMonth(), 1), new Date(today.getFullYear(), today.getMonth() + 1, 0));
    case "last_month":
      return within(new Date(today.getFullYear(), today.getMonth() - 1, 1), new Date(today.getFullYear(), today.getMonth(), 0));
    case "this_year":
      return within(new Date(today.getFullYear(), 0, 1), new Date(today.getFullYear(), 11, 31));
    case "past_week":
      return within(addDays(today, -7), today);
    case "past_month":
      return within(addDays(today, -30), today);
    case "next_week":
      return within(today, addDays(today, 7));
    case "next_month":
      return within(today, addDays(today, 30));
    default:
      return true;
  }
}

export function matchFilter(row: Row, f: Filter, props: Property[], labels: Labels = noLabels): boolean {
  if (!f.rules.length) return true;
  const test = (r: Rule | Filter) => (isFilter(r) ? matchFilter(row, r, props, labels) : matchRule(row, r, props, labels));
  return f.op === "or" ? f.rules.some(test) : f.rules.every(test);
}

export const filterRows = (rows: Row[], f: Filter, props: Property[], labels: Labels = noLabels): Row[] => (f.rules.length ? rows.filter((r) => matchFilter(r, f, props, labels)) : rows);
