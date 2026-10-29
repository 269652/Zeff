import { evalFormula, formulaToStored, splitRefs, type FormulaSheet, type FormulaValue } from "./formula";

/**
 * The tables of a page (/Tabelle) as spreadsheets: a cell whose text starts with "=" is a formula — its own table's cells
 * (A1, B:B, [Spalte] by the header row), the other tables of the page by the name given in their ⋯ menu (Name!A1), the
 * tables shared for formulas (Kosten!B2), Kennzahlen (@Sparrate) and whatever @ puts in a page ([[page:12|Titel]]: a
 * Kennzahl is its value, the rest its name). Worked out in the browser as the page is written; what only the server knows
 * (the Kennzahlen, the shared tables) comes in as `data`. Pure, client-safe.
 */

/** A cell of a page's table: its text (mentions as [[kind:ref|Label]]), where it stands in the document, whether it is a header. */
export type PageCell = { text: string; pos: number; size: number; header: boolean };
/** A table of the page: its name for formulas ("" none), its rows of cells. */
export type PageTable = { name: string; pos: number; rows: PageCell[][] };
/** What the server knows: the Kennzahlen (by key) and the shared tables (by name, lower case: their columns and values). */
export type FormulaData = { metrics: Record<string, number | null>; sheets: Record<string, { cols: string[]; rows: unknown[][] }> };
export type CellResult = { value: string | number | boolean | null; error?: string };

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

/** A cell's text as a value: a number (800, -60,5, 1.200,50, 12 €, 5 %), else the text (mentions as their names), empty as null. */
export function cellNumberOrText(text: string): string | number | null {
  const plain = splitRefs(text)
    .map((x) => ("text" in x ? x.text : x.label))
    .join("")
    .trim();
  if (!plain) return null;
  const s = plain.replace(/\s*(€|\$|%|EUR)$/i, "").replace(/\s/g, "");
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) return Number(s.replace(/\./g, "").replace(",", "."));
  if (/^-?\d+([.,]\d+)?$/.test(s)) return Number(s.replace(",", "."));
  return plain;
}

/** A formula's value as a cell shows it. */
export function formatCellValue(v: CellResult["value"], locale?: string): string {
  if (v === null) return "";
  if (typeof v === "number") return v.toLocaleString(locale, { maximumFractionDigits: Math.abs(v) >= 100 ? 2 : 6 });
  if (typeof v === "boolean") return v ? "✓" : "✗";
  return String(v);
}

/** Every formula cell of the page's tables, worked out — by where the cell stands in the document. */
export function evaluatePageTables(tables: PageTable[], data: FormulaData): Map<number, CellResult> {
  const out = new Map<number, CellResult>();
  const memo = new Map<string, unknown>();
  const errors = new Map<string, string>();
  const busy = new Set<string>();
  const named = new Map(tables.filter((t) => t.name.trim()).map((t) => [t.name.trim().toLowerCase(), t]));

  const value = (t: PageTable, r: number, c: number): unknown => {
    const cell = t.rows[r]?.[c];
    if (!cell) return null;
    if (!cell.text.trimStart().startsWith("=")) return cellNumberOrText(cell.text);
    const key = `${t.pos}:${r}:${c}`;
    if (memo.has(key)) return memo.get(key);
    if (busy.has(key)) throw new Error("Circular formula");
    busy.add(key);
    try {
      const res = formula(t, r, c);
      if (res.error) errors.set(key, res.error);
      memo.set(key, res.error ? null : res.value);
      return res.error ? null : res.value;
    } finally {
      busy.delete(key);
    }
  };
  const sheetOf = (t: PageTable, row?: number): FormulaSheet => {
    const head = t.rows[0]?.some((x) => x.header) ? t.rows[0] : [];
    return {
      rows: t.rows.length,
      cols: Math.max(0, ...t.rows.map((r) => r.length)),
      cell: (c, r) => value(t, r, c),
      colIndex: (name) => head.findIndex((h) => String(cellNumberOrText(h.text) ?? "").toLowerCase() === name.trim().toLowerCase()),
      row,
    };
  };
  const serverSheet = (name: string): FormulaSheet | null => {
    const s = data.sheets[name.trim().toLowerCase()];
    if (!s) return null;
    return { rows: s.rows.length, cols: s.cols.length, cell: (c, r) => s.rows[r]?.[c] ?? null, colIndex: (n) => s.cols.findIndex((x) => x.toLowerCase() === n.trim().toLowerCase()) };
  };
  const formula = (t: PageTable, r: number, c: number): CellResult => {
    const res = evalFormula(t.rows[r][c].text.trim().replace(/^=/, ""), {
      prop: () => {
        throw new Error("prop() is for a database's columns — here [Column] or A1");
      },
      sheet: (name) => {
        if (name === null) return sheetOf(t, r);
        const other = named.get(name.trim().toLowerCase());
        return other ? sheetOf(other) : serverSheet(name);
      },
      metric: (name) => {
        const k = metricKey(name);
        if (!(k in data.metrics)) throw new Error(`No Kennzahl "${name}"`);
        return data.metrics[k];
      },
    });
    if ("error" in res) return { value: null, error: res.error };
    const v = formulaToStored(res.value as FormulaValue);
    return { value: Array.isArray(v) ? v.join(", ") : v };
  };

  for (const t of tables)
    t.rows.forEach((row, r) =>
      row.forEach((cell, c) => {
        if (!cell.text.trimStart().startsWith("=")) return;
        try {
          const v = value(t, r, c) as CellResult["value"];
          const err = errors.get(`${t.pos}:${r}:${c}`);
          out.set(cell.pos, err ? { value: null, error: err } : { value: v });
        } catch (e) {
          out.set(cell.pos, { value: null, error: e instanceof Error ? e.message : String(e) });
        }
      }),
    );
  return out;
}
