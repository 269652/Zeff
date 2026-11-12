import { evalFormula, type FormulaSheet, type FormulaValue } from "./formula";
import { numberWithUnit } from "./units";

/**
 * Tables that are transformed on a page: a table (the page's own /Tabelle, or the output of an earlier transform) goes
 * through steps — filter, sort, group and total, a column worked out by a formula, columns picked or renamed, doubles
 * removed, the first N — and comes out as a table again. A "pipe" block on the page keeps the steps; a "result table"
 * shows what comes out, anywhere on the page. Pure and client-safe: the steps work on plain grids.
 */

export type Cell = string | number | boolean | null;
export type Grid = { cols: string[]; rows: Cell[][] };

export const CMPS = ["=", "!=", ">", "<", ">=", "<=", "contains", "not_contains", "starts", "empty", "not_empty"] as const;
export type Cmp = (typeof CMPS)[number];
export const AGGS = ["sum", "count", "avg", "min", "max"] as const;
export type Agg = (typeof AGGS)[number];

export type PipeStep =
  | { op: "filter"; col: string; cmp: Cmp; value?: string }
  | { op: "sort"; col: string; dir: "asc" | "desc" }
  | { op: "group"; by: string; agg: Agg; col?: string; as?: string }
  | { op: "add"; name: string; formula: string }
  | { op: "pick"; cols: string[] }
  | { op: "rename"; col: string; to: string }
  | { op: "unique"; col?: string }
  | { op: "limit"; n: number };

export const OPS = ["filter", "sort", "group", "add", "pick", "rename", "unique", "limit"] as const;
export const MAX_STEPS = 24;
export const MAX_ROWS = 5000;

/** A cell as a number: a number, or text like "1.200,50 €" / "12" (the unit dropped); null when it isn't one. */
export function numOf(v: Cell | undefined): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string" || !v.trim()) return null;
  const n = numberWithUnit(v);
  return n ? n.n : null;
}

/** What a cell reads as for comparing: a number when it is one, else its lower-case text. */
const text = (v: Cell | undefined): string => (v === null || v === undefined ? "" : String(v));
const isEmpty = (v: Cell | undefined): boolean => text(v).trim() === "";
/** A date written 2026-11-12 or 12.11.2026 as a sortable number; null: not a date. */
function dateOf(v: Cell | undefined): number | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return Date.UTC(+iso[1], +iso[2] - 1, +iso[3]);
  const de = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
  return de ? Date.UTC(+de[3], +de[2] - 1, +de[1]) : null;
}

/** Two cells in order: numbers as numbers, dates as dates, else as text (empty ones last). */
export function compareCells(a: Cell | undefined, b: Cell | undefined): number {
  if (isEmpty(a) || isEmpty(b)) return isEmpty(a) === isEmpty(b) ? 0 : isEmpty(a) ? 1 : -1;
  const na = numOf(a);
  const nb = numOf(b);
  if (na !== null && nb !== null) return na - nb;
  const da = dateOf(a);
  const db = dateOf(b);
  if (da !== null && db !== null) return da - db;
  return text(a).localeCompare(text(b), undefined, { numeric: true, sensitivity: "base" });
}

const colIndex = (g: Grid, name: string): number => g.cols.findIndex((c) => c.trim().toLowerCase() === String(name ?? "").trim().toLowerCase());

function need(g: Grid, name: string, what: string): number {
  const i = colIndex(g, name);
  if (i < 0) throw new Error(`${what}: no column “${name}” (there are: ${g.cols.join(", ") || "none"}).`);
  return i;
}

export function matches(cell: Cell | undefined, cmp: Cmp, value: string): boolean {
  switch (cmp) {
    case "empty":
      return isEmpty(cell);
    case "not_empty":
      return !isEmpty(cell);
    case "contains":
      return text(cell).toLowerCase().includes(value.toLowerCase());
    case "not_contains":
      return !text(cell).toLowerCase().includes(value.toLowerCase());
    case "starts":
      return text(cell).toLowerCase().startsWith(value.toLowerCase());
  }
  // A comparison: numbers as numbers, dates as dates, else text.
  const c = isEmpty(cell) || value.trim() === "" ? (isEmpty(cell) && value.trim() === "" ? 0 : NaN) : compareCells(cell, value);
  if (Number.isNaN(c)) return cmp === "!=";
  return cmp === "=" ? c === 0 : cmp === "!=" ? c !== 0 : cmp === ">" ? c > 0 : cmp === "<" ? c < 0 : cmp === ">=" ? c >= 0 : c <= 0;
}

/** A formula for one row: [Spalte] is that row's column, A1 / B:B the grid's cells — as in a page's table. */
function rowSheet(g: Grid, row: number): FormulaSheet {
  return {
    rows: g.rows.length,
    cols: g.cols.length,
    cell: (c, r) => g.rows[r]?.[c] ?? null,
    colIndex: (name) => colIndex(g, name),
    row,
  };
}

function addColumn(g: Grid, name: string, formula: string): Grid {
  if (!name.trim()) throw new Error("Computed column: it needs a name.");
  if (!formula.trim()) throw new Error(`Computed column “${name}”: it needs a formula.`);
  const rows = g.rows.map((r, i) => {
    // Numbers written as text ("12", "1.200,50 €") count as numbers in the formula.
    const typed: Grid = { cols: g.cols, rows: g.rows.map((x) => x.map((c) => numOf(c) ?? c)) };
    const res = evalFormula(formula.trim().replace(/^=/, ""), { prop: () => null, sheet: (n) => (n === null ? rowSheet(typed, i) : null) });
    if ("error" in res) throw new Error(`Computed column “${name}”: ${res.error}`);
    const v: FormulaValue = res.value;
    return [...r, v instanceof Date ? v.toISOString().slice(0, 10) : Array.isArray(v) ? v.join(", ") : (v as Cell)];
  });
  return { cols: [...g.cols, name.trim()], rows };
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

function group(g: Grid, s: Extract<PipeStep, { op: "group" }>): Grid {
  const by = need(g, s.by, "Group");
  const col = s.agg === "count" ? -1 : need(g, s.col ?? "", `${s.agg}`);
  const label = s.as?.trim() || (s.agg === "count" ? "Count" : `${s.agg[0].toUpperCase()}${s.agg.slice(1)} ${g.cols[col]}`);
  const groups = new Map<string, { key: Cell; rows: Cell[][] }>();
  for (const r of g.rows) {
    const k = text(r[by]).trim().toLowerCase();
    const hit = groups.get(k);
    if (hit) hit.rows.push(r);
    else groups.set(k, { key: r[by] ?? null, rows: [r] });
  }
  const rows = [...groups.values()].map(({ key, rows: rs }): Cell[] => {
    if (s.agg === "count") return [key, rs.length];
    const nums = rs.map((r) => numOf(r[col])).filter((x): x is number => x !== null);
    if (!nums.length) return [key, null];
    const v = s.agg === "sum" ? nums.reduce((a, b) => a + b, 0) : s.agg === "avg" ? nums.reduce((a, b) => a + b, 0) / nums.length : s.agg === "min" ? Math.min(...nums) : Math.max(...nums);
    return [key, round(v)];
  });
  return { cols: [g.cols[by], label], rows };
}

/** One step applied; what is wrong with it said in words (it throws). */
export function applyStep(g: Grid, s: PipeStep): Grid {
  switch (s.op) {
    case "filter": {
      const i = need(g, s.col, "Filter");
      return { cols: g.cols, rows: g.rows.filter((r) => matches(r[i], s.cmp, s.value ?? "")) };
    }
    case "sort": {
      const i = need(g, s.col, "Sort");
      const sign = s.dir === "desc" ? -1 : 1;
      // (Stable; empty cells stay last either way.)
      const rows = g.rows
        .map((r, k) => ({ r, k }))
        .sort((a, b) => (isEmpty(a.r[i]) || isEmpty(b.r[i]) ? compareCells(a.r[i], b.r[i]) : sign * compareCells(a.r[i], b.r[i])) || a.k - b.k)
        .map((x) => x.r);
      return { cols: g.cols, rows };
    }
    case "group":
      return group(g, s);
    case "add":
      return addColumn(g, s.name, s.formula);
    case "pick": {
      const idx = s.cols.map((c) => need(g, c, "Columns"));
      return { cols: idx.map((i) => g.cols[i]), rows: g.rows.map((r) => idx.map((i) => r[i] ?? null)) };
    }
    case "rename": {
      const i = need(g, s.col, "Rename");
      if (!s.to.trim()) throw new Error("Rename: the new name is empty.");
      return { cols: g.cols.map((c, k) => (k === i ? s.to.trim() : c)), rows: g.rows };
    }
    case "unique": {
      const i = s.col ? need(g, s.col, "Unique") : -1;
      const seen = new Set<string>();
      return {
        cols: g.cols,
        rows: g.rows.filter((r) => {
          const k = (i < 0 ? r.map(text).join("\u0001") : text(r[i])).trim().toLowerCase();
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        }),
      };
    }
    case "limit":
      return { cols: g.cols, rows: g.rows.slice(0, Math.max(0, Math.floor(Number(s.n)) || 0)) };
  }
}

/** The steps in order. A step that fails stops the run: what came before is returned with the error, saying which step. */
export function runPipe(input: Grid, steps: PipeStep[]): { grid: Grid; error?: string; failed?: number } {
  let g: Grid = { cols: input.cols.map((c) => String(c ?? "")), rows: input.rows.slice(0, MAX_ROWS) };
  for (let i = 0; i < steps.length && i < MAX_STEPS; i++) {
    try {
      g = applyStep(g, steps[i]);
    } catch (e) {
      return { grid: g, error: e instanceof Error ? e.message : String(e), failed: i };
    }
  }
  return { grid: g };
}

/** A step in a short phrase ("Betrag > 50", "sorted by Datum ↑") — for the block's list. */
export function stepText(s: PipeStep): string {
  switch (s.op) {
    case "filter":
      return `${s.col} ${s.cmp === "empty" ? "is empty" : s.cmp === "not_empty" ? "is not empty" : `${s.cmp} ${s.value ?? ""}`}`.trim();
    case "sort":
      return `sort ${s.col} ${s.dir === "desc" ? "↓" : "↑"}`;
    case "group":
      return s.agg === "count" ? `count by ${s.by}` : `${s.agg} ${s.col} by ${s.by}`;
    case "add":
      return `${s.name} = ${s.formula}`;
    case "pick":
      return `columns ${s.cols.join(", ")}`;
    case "rename":
      return `${s.col} → ${s.to}`;
    case "unique":
      return s.col ? `unique ${s.col}` : "unique rows";
    case "limit":
      return `first ${s.n}`;
  }
}

const str = (v: unknown, max = 200): string => (typeof v === "string" ? v.trim().slice(0, max) : typeof v === "number" ? String(v) : "");

/** Steps as they are kept — anything that isn't a known step dropped (steps come from a page, from the AI: never trusted). */
export function normalizeSteps(raw: unknown): PipeStep[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: PipeStep[] = [];
  for (const x of list.slice(0, MAX_STEPS)) {
    const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    switch (o.op) {
      case "filter": {
        const cmp = (CMPS as readonly string[]).includes(String(o.cmp)) ? (String(o.cmp) as Cmp) : "=";
        if (str(o.col)) out.push({ op: "filter", col: str(o.col), cmp, ...(str(o.value) ? { value: str(o.value) } : {}) });
        break;
      }
      case "sort":
        if (str(o.col)) out.push({ op: "sort", col: str(o.col), dir: o.dir === "desc" ? "desc" : "asc" });
        break;
      case "group": {
        const agg = (AGGS as readonly string[]).includes(String(o.agg)) ? (String(o.agg) as Agg) : "count";
        if (str(o.by)) out.push({ op: "group", by: str(o.by), agg, ...(str(o.col) ? { col: str(o.col) } : {}), ...(str(o.as) ? { as: str(o.as, 80) } : {}) });
        break;
      }
      case "add":
        if (str(o.name, 80) && str(o.formula, 500)) out.push({ op: "add", name: str(o.name, 80), formula: str(o.formula, 500) });
        break;
      case "pick": {
        const cols = (Array.isArray(o.cols) ? o.cols : []).map((c) => str(c)).filter(Boolean).slice(0, 60);
        if (cols.length) out.push({ op: "pick", cols });
        break;
      }
      case "rename":
        if (str(o.col) && str(o.to, 80)) out.push({ op: "rename", col: str(o.col), to: str(o.to, 80) });
        break;
      case "unique":
        out.push({ op: "unique", ...(str(o.col) ? { col: str(o.col) } : {}) });
        break;
      case "limit": {
        const n = Math.floor(Number(o.n));
        if (n >= 0) out.push({ op: "limit", n: Math.min(n, MAX_ROWS) });
        break;
      }
    }
  }
  return out;
}

/** Steps kept as the page keeps them (a JSON text in a block's attribute). */
export const stepsToText = (steps: PipeStep[]): string => (steps.length ? JSON.stringify(steps) : "");
export function stepsFromText(t: unknown): PipeStep[] {
  if (typeof t !== "string" || !t.trim()) return [];
  try {
    return normalizeSteps(JSON.parse(t));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// The page: tables and pipes by name
// ---------------------------------------------------------------------------

/** A table of the page for a pipe to read: the first row is the header when it is made of header cells. */
export type PageGrid = { name: string; grid: Grid };
/** A pipe block of the page: its name (what a result table calls it), what it reads, its steps. */
export type PipeDef = { name: string; from: string; steps: PipeStep[] };
/** A result table's outcome: its grid, or what is wrong (in words). */
export type Outcome = { grid: Grid; error?: string };

/**
 * Every pipe of the page worked out, by lower-case name. A pipe reads a table of the page by name or another pipe (earlier or
 * later on the page — they chain; a loop is said, not run). `db:<id>` sources come in through `external`.
 */
export function evaluatePipes(tables: PageGrid[], pipes: PipeDef[], external: Record<string, Grid> = {}): Map<string, Outcome> {
  const out = new Map<string, Outcome>();
  const byName = new Map(tables.filter((t) => t.name.trim()).map((t) => [t.name.trim().toLowerCase(), t.grid]));
  const defs = new Map(pipes.filter((p) => p.name.trim()).map((p) => [p.name.trim().toLowerCase(), p]));
  const busy = new Set<string>();
  const empty: Grid = { cols: [], rows: [] };
  const source = (from: string): Outcome => {
    const k = from.trim().toLowerCase();
    if (!k) return { grid: empty, error: "Choose where this reads from." };
    if (k in external) return { grid: external[k] };
    const t = byName.get(k);
    if (t) return { grid: t };
    if (defs.has(k)) return resolve(k);
    return { grid: empty, error: `There is no table or pipe called “${from.trim()}” on this page.` };
  };
  const resolve = (key: string): Outcome => {
    const hit = out.get(key);
    if (hit) return hit;
    const def = defs.get(key)!;
    if (busy.has(key)) return { grid: empty, error: "The pipes read each other in a circle." };
    busy.add(key);
    try {
      const src = source(def.from);
      if (src.error && !src.grid.cols.length) {
        const r = { grid: empty, error: src.error };
        out.set(key, r);
        return r;
      }
      const run = runPipe(src.grid, def.steps);
      const r: Outcome = { grid: run.grid, ...(run.error ? { error: `Step ${(run.failed ?? 0) + 1}: ${run.error}` } : src.error ? { error: src.error } : {}) };
      out.set(key, r);
      return r;
    } finally {
      busy.delete(key);
    }
  };
  for (const k of defs.keys()) resolve(k);
  return out;
}

/** What a result table shows: a pipe's output, or a table of the page (or an outside source) as it is. */
export function outcomeFor(of: string, tables: PageGrid[], outcomes: Map<string, Outcome>, external: Record<string, Grid> = {}): Outcome {
  const k = of.trim().toLowerCase();
  if (!k) return { grid: { cols: [], rows: [] }, error: "Choose what this table shows." };
  const o = outcomes.get(k);
  if (o) return o;
  if (k in external) return { grid: external[k] };
  const t = tables.find((x) => x.name.trim().toLowerCase() === k);
  return t ? { grid: t.grid } : { grid: { cols: [], rows: [] }, error: `There is no table or pipe called “${of.trim()}” on this page.` };
}

/** A page table's cells as a grid: the header row (if it has one) names the columns, else A, B, C …; numbers stay text (numOf reads them). */
export function gridOfCells(rows: { text: string; header: boolean }[][]): Grid {
  const width = Math.max(0, ...rows.map((r) => r.length));
  const hasHead = !!rows[0]?.length && rows[0].every((c) => c.header);
  const names = hasHead ? Array.from({ length: width }, (_, i) => rows[0][i]?.text.trim() || `Col ${i + 1}`) : Array.from({ length: width }, (_, i) => String.fromCharCode(65 + (i % 26)) + (i >= 26 ? Math.floor(i / 26) : ""));
  const body = (hasHead ? rows.slice(1) : rows).map((r) => Array.from({ length: width }, (_, i): Cell => (r[i]?.text.trim() ? r[i].text.trim() : null)));
  return { cols: names, rows: body };
}

/** The ready-made examples the "/" menu offers: a table of data and the steps that turn it into the second one. */
export type PipeExample = { key: string; icon: string; title: string; hint: string; name: string; cols: string[]; rows: string[][]; steps: PipeStep[]; outName: string };
export const PIPE_EXAMPLES: PipeExample[] = [
  {
    key: "budget",
    icon: "💶",
    title: "Household budget",
    hint: "Spending by category, biggest first",
    name: "Ausgaben",
    cols: ["Datum", "Beschreibung", "Betrag", "Kategorie"],
    rows: [
      ["2026-11-01", "Miete", "850", "Wohnen"],
      ["2026-11-02", "Supermarkt", "63,40", "Essen"],
      ["2026-11-03", "Bahnticket", "29", "Reise"],
      ["2026-11-05", "Strom", "54", "Wohnen"],
      ["2026-11-06", "Restaurant", "41,50", "Essen"],
      ["2026-11-08", "Kino", "14", "Freizeit"],
      ["2026-11-09", "Supermarkt", "48,20", "Essen"],
      ["2026-11-10", "Buch", "19", "Freizeit"],
    ],
    steps: [
      { op: "group", by: "Kategorie", agg: "sum", col: "Betrag", as: "Summe" },
      { op: "sort", col: "Summe", dir: "desc" },
    ],
    outName: "Pro Kategorie",
  },
  {
    key: "favourites",
    icon: "📚",
    title: "Books: my favourites",
    hint: "Only the good ones, newest first",
    name: "Bücher",
    cols: ["Titel", "Autor", "Bewertung", "Jahr"],
    rows: [
      ["Momo", "Michael Ende", "5", "1973"],
      ["Die Verwandlung", "Franz Kafka", "4", "1915"],
      ["Tintenherz", "Cornelia Funke", "3", "2003"],
      ["Der Vorleser", "Bernhard Schlink", "4", "1995"],
      ["Siddhartha", "Hermann Hesse", "2", "1922"],
    ],
    steps: [
      { op: "filter", col: "Bewertung", cmp: ">=", value: "4" },
      { op: "sort", col: "Jahr", dir: "desc" },
      { op: "pick", cols: ["Titel", "Autor", "Jahr"] },
    ],
    outName: "Favoriten",
  },
  {
    key: "recipe",
    icon: "🍲",
    title: "Recipe for more people",
    hint: "Amounts times a factor",
    name: "Zutaten",
    cols: ["Zutat", "Menge", "Einheit"],
    rows: [
      ["Mehl", "250", "g"],
      ["Milch", "0,5", "l"],
      ["Eier", "3", "Stück"],
      ["Zucker", "40", "g"],
    ],
    steps: [
      { op: "add", name: "Menge für 6", formula: "[Menge] * 6 / 4" },
      { op: "pick", cols: ["Zutat", "Menge für 6", "Einheit"] },
    ],
    outName: "Für 6 Personen",
  },
  {
    key: "tidy",
    icon: "🧹",
    title: "Tidy up a list",
    hint: "Doubles out, sorted",
    name: "Kontakte",
    cols: ["Name", "Ort"],
    rows: [
      ["Anna Meier", "Köln"],
      ["Ben Schulz", "Berlin"],
      ["anna meier", "Köln"],
      ["Clara Weiß", "Hamburg"],
      ["Ben Schulz", "Berlin"],
    ],
    steps: [
      { op: "unique", col: "Name" },
      { op: "sort", col: "Name", dir: "asc" },
    ],
    outName: "Aufgeräumt",
  },
];

/**
 * The sentence of a description the AI gave: its text, or — when it came wrapped ({"description":"…"}, in a code fence, in quotes)
 * — what is inside. Never JSON: a description is for people.
 */
export function plainDescription(raw: unknown): string {
  let v: unknown = raw;
  for (let i = 0; i < 3; i++) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      v = o.description ?? o.desc ?? o.text ?? "";
      continue;
    }
    if (typeof v !== "string") return "";
    const t = v.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    if (/^[{[]/.test(t)) {
      try {
        v = JSON.parse(t) as unknown;
        if (Array.isArray(v)) return "";
        continue;
      } catch {
        // (cut off or not JSON after all: the description key's text, if there is one)
        const m = /"(?:description|desc)"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(t);
        return m ? m[1].replace(/\\"/g, '"').replace(/\\n/g, " ").trim().slice(0, 300) : "";
      }
    }
    return t.replace(/^["“]+|["”]+$/g, "").replace(/\s+/g, " ").trim().slice(0, 300);
  }
  return "";
}

/** A value as a table when it looks like one: {cols, rows}, a list of objects, a list of lists. */
export function asGrid(v: unknown): Grid | null {
  const cellOf = (x: unknown): Cell => (typeof x === "number" || typeof x === "string" || typeof x === "boolean" || x === null ? x : x === undefined ? null : JSON.stringify(x));
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as { cols?: unknown; rows?: unknown };
    if (Array.isArray(o.cols) && Array.isArray(o.rows) && o.rows.every(Array.isArray)) return { cols: o.cols.map(String), rows: (o.rows as unknown[][]).map((r) => r.map(cellOf)) };
    return null;
  }
  if (!Array.isArray(v) || !v.length) return null;
  if (v.every((r) => r && typeof r === "object" && !Array.isArray(r))) {
    const cols = [...new Set(v.flatMap((r) => Object.keys(r as object)))];
    return { cols, rows: v.map((r) => cols.map((c) => cellOf((r as Record<string, unknown>)[c]))) };
  }
  if (v.every(Array.isArray)) {
    const width = Math.max(...(v as unknown[][]).map((r) => r.length));
    return { cols: Array.from({ length: width }, (_, i) => String.fromCharCode(65 + (i % 26))), rows: (v as unknown[][]).map((r) => Array.from({ length: width }, (_, i) => cellOf(r[i]))) };
  }
  return null;
}
