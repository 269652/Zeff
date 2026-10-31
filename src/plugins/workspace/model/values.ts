import { type Property, type Row, type DbSchema, columnOrder, TITLE, propById } from "./schema";
import { ids } from "./util";

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

/** A date value as {start, end?}: a text "2026-10-14" / "2026-10-14T09:00", or {start, end}. */
export function dateRange(v: unknown): { start: string; end?: string } | null {
  if (typeof v === "string" && v) return { start: v };
  if (v && typeof v === "object" && typeof (v as { start?: unknown }).start === "string" && (v as { start: string }).start) {
    const o = v as { start: string; end?: unknown };
    return { start: o.start, end: typeof o.end === "string" && o.end ? o.end : undefined };
  }
  return null;
}

export const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === null || v === undefined || v === "" ? [] : [v]);

/**
 * A cell value made to fit its property, as it is stored: what can't be is dropped (null). The server's (store.ts coerceCell, which
 * passes the custom field types' parser) and the table's, which shows an edit at once as it will come back.
 */
export function coerceCellValue(p: Property, v: unknown, parseCustom: (typeId: string | undefined, v: unknown) => unknown = (_, x) => x): unknown {
  if (v === null || v === undefined) return null;
  switch (p.type) {
    case "number": {
      const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
      return v === "" || Number.isNaN(n) ? null : n;
    }
    case "checkbox":
      return !!v;
    case "select":
    case "status":
      return p.options?.some((o) => o.id === v) ? v : null;
    case "multi_select": {
      const a = (Array.isArray(v) ? v : [v]).filter((x) => p.options?.some((o) => o.id === x));
      return a.length ? [...new Set(a)] : null;
    }
    case "date": {
      const r = dateRange(v);
      if (!r || !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(r.start) || (r.end !== undefined && !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(r.end))) return null;
      return r.end ? { start: r.start, end: r.end } : r.start;
    }
    case "person":
    case "todo":
    case "relation": {
      const a = (Array.isArray(v) ? v : [v]).map(Number).filter((n) => Number.isInteger(n) && n > 0);
      return a.length ? [...new Set(a)] : null;
    }
    case "ticket": {
      const a = (Array.isArray(v) ? v : [v]).map((x) => String(x).trim().toUpperCase()).filter((x) => /^[A-Z][A-Z0-9]+-\d+$/.test(x));
      return a.length ? [...new Set(a)] : null;
    }
    case "url":
    case "email":
    case "phone":
      return String(v).trim().slice(0, 500) || null;
    case "custom":
      return parseCustom(p.custom, v);
    case "text":
    case "markdown":
    case "ai":
      return String(v).slice(0, 20000) || null;
    default:
      return null; // computed: never stored
  }
}

/**
 * A row dropped above (or, `after`, below) another in a list of rows: the rows it lands between (null at either end) — null when it
 * stays where it is (dropped on itself, or right next to where it was).
 */
export function dropBetween(ids: number[], from: number, to: number, after: boolean): { after: number | null; before: number | null } | null {
  if (from === to) return null;
  const rest = ids.filter((id) => id !== from);
  const at = rest.indexOf(to);
  if (at < 0) return null;
  const slot = after ? at + 1 : at;
  const was = ids.indexOf(from);
  if (was === slot) return null;
  return { after: slot > 0 ? rest[slot - 1] : null, before: slot < rest.length ? rest[slot] : null };
}

// ---------------------------------------------------------------------------
// A cell's own formula (a spreadsheet's "=SUMME(B1:B3)")
// ---------------------------------------------------------------------------

/** Where a cell keeps its formula: beside its value, under its column's id with "=" (the value is worked out when read). */
export const formulaKey = (propId: string) => `${propId}=`;
/** The columns whose cells may hold a formula: numbers and texts. */
export const takesCellFormula = (p: Pick<Property, "type">): boolean => p.type === "number" || p.type === "text";
/** What was typed is a formula: it starts with "=" (and has more). */
export const isFormulaInput = (v: unknown): v is string => typeof v === "string" && /^=\s*\S/.test(v.trim());
/** A cell's formula ("=…"), or null. */
export const cellFormula = (row: Pick<Row, "cells">, propId: string): string | null => {
  const f = row.cells[formulaKey(propId)];
  return typeof f === "string" && f.trim() ? f : null;
};
/** A column's unit by its format: € (euro), $ (dollar), h (hours), its own (unit) — null for none (a percent column holds fractions). */
export const columnUnit = (p: Pick<Property, "format" | "unit"> | undefined): string | null =>
  !p ? null : p.format === "euro" ? "€" : p.format === "dollar" ? "$" : p.format === "hours" ? "h" : p.format === "unit" && p.unit?.trim() ? p.unit.trim() : null;

/** Whether any cell of these rows holds a formula. */
export const hasCellFormulas = (rows: Pick<Row, "cells">[]): boolean => rows.some((r) => Object.keys(r.cells).some((k) => k.endsWith("=")));

/**
 * The columns of a table as a spreadsheet counts them (A = the first): the order its first table view shows (hidden ones keep
 * their letter), the title among them.
 */
export function sheetColumns(schema: Pick<DbSchema, "properties" | "views">): string[] {
  const view = schema.views.find((v) => v.type === "table") ?? schema.views[0];
  return view ? columnOrder(view, schema) : [TITLE, ...schema.properties.map((p) => p.id)];
}

/** How a shared table is named in a formula: plain when it is one word (Kosten!B2), else in quotes ('Meine Kosten'!B2). */
export const sheetRef = (name: string): string => (/^[\p{L}_][\p{L}\p{N}_]*$/u.test(name) ? name : `'${name.replace(/'/g, "")}'`);

/** The rows with one cell (or the title) changed — as it will be stored, so a table shows an edit at once and as it comes back. */
export function withCell(rows: Row[], props: Property[], rowId: number, propId: string, value: unknown): Row[] {
  const p = propId === TITLE ? undefined : propById(props, propId);
  // A formula typed in: kept as the formula, its value comes when the table is read again.
  if (p && takesCellFormula(p) && isFormulaInput(value)) return rows.map((r) => (r.id !== rowId ? r : { ...r, cells: { ...r.cells, [propId]: undefined, [formulaKey(propId)]: value.trim() } }));
  const v = p ? coerceCellValue(p, value) : value;
  return rows.map((r) => (r.id !== rowId ? r : propId === TITLE ? { ...r, title: String(value ?? "") } : { ...r, cells: { ...r.cells, [propId]: v === null || v === "" ? undefined : v, [formulaKey(propId)]: undefined, [`${propId}!`]: undefined } }));
}

export function isEmptyValue(p: Property | undefined, v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (p?.type === "checkbox") return false;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  if (p?.type === "date") return dateRange(v) === null;
  return false;
}

export type Labels = {
  /** The name behind a person, page or todo id. */
  person: (id: number) => string;
  page: (id: number) => string;
  todo: (id: number) => string;
  now?: Date;
};
export const noLabels: Labels = { person: (id) => `#${id}`, page: (id) => `#${id}`, todo: (id) => `T-${id}` };

export const optionName = (p: Property, id: unknown): string => p.options?.find((o) => o.id === id)?.name ?? (typeof id === "string" ? id : "");

/** A cell as plain text — for display fallbacks, search, export, and what the AI reads. */
export function cellText(p: Property | undefined, v: unknown, labels: Labels = noLabels): string {
  if (!p) return v === null || v === undefined ? "" : String(v);
  if (isEmptyValue(p, v)) return p.type === "checkbox" ? "No" : "";
  switch (p.type) {
    case "select":
    case "status":
      return optionName(p, v);
    case "multi_select":
      return asArray(v).map((x) => optionName(p, x)).join(", ");
    case "checkbox":
      return v ? "Yes" : "No";
    case "number":
      return typeof v === "number" ? formatNumber(p, v) : String(v);
    case "date": {
      const r = dateRange(v);
      return r ? (r.end ? `${r.start} → ${r.end}` : r.start) : "";
    }
    case "person":
      return asArray(v).map((x) => labels.person(Number(x))).join(", ");
    case "relation":
      // The rows of a source (the booked time) aren't pages: how many there are.
      if (p.relationSource !== undefined) return String(asArray(v).length);
      return asArray(v).map((x) => labels.page(Number(x))).join(", ");
    case "todo":
      return asArray(v).map((x) => labels.todo(Number(x))).join(", ");
    case "created_time":
    case "updated_time":
      return String(v).slice(0, 16).replace("T", " ");
    default:
      if (Array.isArray(v)) return v.map((x) => (typeof x === "number" && p.type === "rollup" ? formatNumber(p, x) : String(x))).join(", ");
      if (typeof v === "number") return formatNumber(p, v);
      return String(v);
  }
}

export function formatNumber(p: Property, n: number): string {
  const r = Math.round(n * 1e6) / 1e6;
  switch (p.format) {
    case "percent":
      return `${Math.round(r * 10000) / 100} %`;
    case "euro":
      return `${r.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
    case "dollar":
      return `$${r.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    case "hours":
      return `${r} h`;
    case "unit":
      return p.unit?.trim() ? `${r} ${p.unit.trim()}` : String(r);
    default:
      return String(r);
  }
}
