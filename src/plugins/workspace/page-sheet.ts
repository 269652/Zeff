import { callKey, evalWithUnits, formulaToStored, fromWire, splitRefs, toWire, type FormulaSheet, type FormulaValue, type WireValue } from "./formula";
import { numberWithUnit } from "./units";

/**
 * The tables of a page (/Tabelle) as spreadsheets: a cell whose text starts with "=" is a formula — its own table's cells
 * (A1, B:B, [Spalte] by the header row), the other tables of the page by the name given in their ⋯ menu (Name!A1), the
 * tables shared for formulas (Kosten!B2), Kennzahlen (@Sparrate) and whatever @ puts in a page ([[page:12|Titel]]: a
 * Kennzahl is its value, the rest its name). With units (units.ts): a cell that is a Kennzahl (its chip alone) is its value
 * in its unit, "12 €" and "5 h" are numbers in theirs, a result says what it is in — a number without one takes the other
 * side's, what fits is converted, what doesn't is flagged. Worked out in the browser as the page is written; what only the
 * server knows (the Kennzahlen, the shared tables) comes in as `data`. Pure, client-safe.
 */

/** A cell of a page's table: its text (mentions as [[kind:ref|Label]]), where it stands in the document, whether it is a header. */
export type PageCell = { text: string; pos: number; size: number; header: boolean };
/** A table of the page: its name for formulas ("" none), its rows of cells. */
export type PageTable = { name: string; pos: number; rows: PageCell[][] };
/** What the server knows: the Kennzahlen (values and units, by key) and the shared tables (by name, lower case: their columns, values, the columns' units). */
export type FormulaData = {
  metrics: Record<string, number | null>;
  metricUnits?: Record<string, string>;
  sheets: Record<string, { cols: string[]; rows: unknown[][]; units?: (string | null)[] }>;
  /** The plugins' functions (Schulden, Personen …): their names and units. */
  functions?: { name: string; aliases: string[]; unit: string }[];
  /** What the server said for calls of them, by callKey. */
  calls?: Record<string, { value: WireValue } | { error: string }>;
};
/** A call of a plugin's function the server hasn't answered yet: asked, its cell shows "…" until then. */
export type PendingCall = { name: string; args: WireValue[] };
/** The error a cell shows while a call is asked. */
export const PENDING = "…";
export type CellResult = { value: string | number | boolean | null; unit?: string; warnings?: string[]; error?: string };

/** A Kennzahl's key, as values.ts makes it ("Frei im Monat" → "frei-im-monat"). */
export const metricKey = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** A cell's text without its mentions' markup (their names). */
const plainText = (text: string) =>
  splitRefs(text)
    .map((x) => ("text" in x ? x.text : x.label))
    .join("")
    .trim();

/**
 * What a cell that isn't a formula holds: a Kennzahl (its chip alone) as its value in its unit, a number with its unit (800,
 * 1.200,50 €, 5 h, 12 % — a unit it doesn't know is one of its own: 3 Stück), else the text (mentions as their names).
 */
export function cellValueOf(text: string, data?: FormulaData | null): { value: string | number | null; unit: string | null } {
  const parts = splitRefs(text.trim()).filter((x) => !("text" in x) || x.text.trim());
  if (parts.length === 1 && !("text" in parts[0]) && parts[0].kind === "metric") {
    const k = parts[0].ref;
    return { value: data?.metrics[k] ?? null, unit: data?.metricUnits?.[k] || null };
  }
  const plain = plainText(text);
  if (!plain) return { value: null, unit: null };
  const n = numberWithUnit(plain);
  return n ? { value: n.n, unit: n.label || null } : { value: plain, unit: null };
}

/** (kept for what used it: the value only) */
export const cellNumberOrText = (text: string): string | number | null => cellValueOf(text).value;

/** A formula's value as a cell shows it, with its unit. */
export function formatCellValue(v: CellResult["value"], locale?: string, unit?: string): string {
  if (v === null) return "";
  if (typeof v === "number") return `${v.toLocaleString(locale, { maximumFractionDigits: Math.abs(v) >= 100 ? 2 : 6 })}${unit ? ` ${unit}` : ""}`;
  if (typeof v === "boolean") return v ? "✓" : "✗";
  // A date: as it is said (1. Juni 2037), with its time when it has one.
  if (v instanceof Date) return v.getHours() || v.getMinutes() ? v.toLocaleString(locale, { dateStyle: "long", timeStyle: "short" }) : v.toLocaleDateString(locale, { dateStyle: "long" });
  return String(v);
}

/** Every formula cell of the page's tables, worked out — by where the cell stands in the document. */
export function evaluatePageTables(tables: PageTable[], data: FormulaData, pending: PendingCall[] = []): Map<number, CellResult> {
  const out = new Map<number, CellResult>();
  const memo = new Map<string, CellResult>();
  const busy = new Set<string>();
  const named = new Map(tables.filter((t) => t.name.trim()).map((t) => [t.name.trim().toLowerCase(), t]));
  const isFormula = (cell: PageCell | undefined) => !!cell && cell.text.trimStart().startsWith("=");

  /** A formula cell worked out (once). */
  const result = (t: PageTable, r: number, c: number): CellResult => {
    const key = `${t.pos}:${r}:${c}`;
    const hit = memo.get(key);
    if (hit) return hit;
    if (busy.has(key)) throw new Error("Circular formula");
    busy.add(key);
    try {
      const res = formula(t, r, c);
      memo.set(key, res);
      return res;
    } finally {
      busy.delete(key);
    }
  };
  const value = (t: PageTable, r: number, c: number): unknown => {
    const cell = t.rows[r]?.[c];
    if (!cell) return null;
    if (!isFormula(cell)) return cellValueOf(cell.text, data).value;
    const res = result(t, r, c);
    if (res.error) throw new Error(`${String.fromCharCode(65 + c)}${r + 1}: ${res.error}`);
    return res.value;
  };
  const unit = (t: PageTable, r: number, c: number): string | null => {
    const cell = t.rows[r]?.[c];
    if (!cell) return null;
    if (!isFormula(cell)) return cellValueOf(cell.text, data).unit;
    try {
      return result(t, r, c).unit || null;
    } catch {
      return null;
    }
  };
  const sheetOf = (t: PageTable, row?: number): FormulaSheet => {
    const head = t.rows[0]?.some((x) => x.header) ? t.rows[0] : [];
    return {
      rows: t.rows.length,
      cols: Math.max(0, ...t.rows.map((r) => r.length)),
      cell: (c, r) => value(t, r, c),
      unit: (c, r) => unit(t, r, c),
      colIndex: (name) => head.findIndex((h) => plainText(h.text).toLowerCase() === name.trim().toLowerCase()),
      row,
    };
  };
  const serverSheet = (name: string): FormulaSheet | null => {
    const s = data.sheets[name.trim().toLowerCase()];
    if (!s) return null;
    return { rows: s.rows.length, cols: s.cols.length, cell: (c, r) => s.rows[r]?.[c] ?? null, unit: (c) => s.units?.[c] ?? null, colIndex: (n) => s.cols.findIndex((x) => x.toLowerCase() === n.trim().toLowerCase()) };
  };
  const formula = (t: PageTable, r: number, c: number): CellResult => {
    const res = evalWithUnits(t.rows[r][c].text.trim().replace(/^=/, ""), {
      prop: () => {
        throw new Error("prop() is for a database's columns — here [Column] or A1");
      },
      sheet: (name) => {
        if (name === null) return sheetOf(t, r);
        const other = named.get(name.trim().toLowerCase());
        return other ? sheetOf(other) : serverSheet(name);
      },
      // (no Kennzahl of that name: undefined — @Freunde is a name then, for a function to resolve)
      metric: (name) => {
        const k = metricKey(name);
        return k in data.metrics ? data.metrics[k] : undefined;
      },
      metricUnit: (name) => data.metricUnits?.[metricKey(name)] || null,
      // A plugin's function: its value as the server said it — or asked, and "…" until then.
      fn: (name) => {
        const n = name.toLowerCase();
        const f = data.functions?.find((x) => x.name.toLowerCase() === n || x.aliases.some((a) => a.toLowerCase() === n));
        if (!f) return null;
        return {
          unit: f.unit,
          call: (args) => {
            const hit = data.calls?.[callKey(name, args)];
            if (hit) {
              if ("error" in hit) throw new Error(hit.error);
              return fromWire(hit.value);
            }
            pending.push({ name, args: args.map(toWire) });
            throw new Error(PENDING);
          },
        };
      },
    });
    if ("error" in res) return { value: null, error: res.error };
    const v = formulaToStored(res.value as FormulaValue);
    return { value: Array.isArray(v) ? v.join(", ") : v, unit: res.unit, warnings: res.warnings };
  };

  for (const t of tables)
    t.rows.forEach((row, r) =>
      row.forEach((cell, c) => {
        if (!isFormula(cell)) return;
        try {
          out.set(cell.pos, result(t, r, c));
        } catch (e) {
          out.set(cell.pos, { value: null, error: e instanceof Error ? e.message : String(e) });
        }
      }),
    );
  return out;
}
