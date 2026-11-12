import { refToken, type RefKind } from "@/plugins/workspace/formula";
import { evaluatePageTables, type FormulaData, type PageTable } from "@/plugins/workspace/page-sheet";
import type { Doc, DocNode } from "@/plugins/workspace/doc";
import { asGrid, evaluatePipes, numOf, stepsFromText, type Cell, type Grid, type PageGrid, type PipeDef } from "@/plugins/workspace/table-pipe";

/**
 * What a page holds as data, the way a code cell may read it: its tables with their formulas worked out, the results of its
 * transforms, and the tables shared for formulas — by name. Pure: the document, the formula data and a way to read a database are given.
 */

/** A cell's text as a formula reads it (mentions as [[kind:ref|Label]]). */
function cellText(cell: DocNode): string {
  const parts: string[] = [];
  for (const block of cell.content ?? []) {
    let line = "";
    const walk = (n: DocNode) => {
      if (n.type === "text") line += n.text ?? "";
      else if (n.type === "zeffRef") line += refToken(String(n.attrs?.kind) as RefKind, String(n.attrs?.ref ?? ""), String(n.attrs?.label ?? ""));
      else if (n.type === "hardBreak") line += " ";
      for (const c of n.content ?? []) walk(c);
    };
    walk(block);
    parts.push(line);
  }
  return parts.join(" ");
}

/** A cell as a value: a number when it is one ("1.200,50 €" → 1200.5), else its text; empty: null. */
const typed = (text: string): Cell => {
  const t = text.trim();
  if (!t) return null;
  const n = numOf(t);
  return n !== null && /^[-+]?[\d.,\s]+\D{0,8}$/.test(t) ? n : t;
};

export type PageGrids = {
  /** By lower-case name: tables, transform results, tables shared for formulas. */
  byName: Map<string, Grid>;
  /** The names as they are written, in the order of the page. */
  names: { name: string; kind: "table" | "transform" | "shared" | "code" }[];
  /** What a named code cell returned that is not a table (a number, a text, a list of numbers …), by lower-case name. */
  values: Map<string, unknown>;
  /** A transform that does not work, by lower-case name: why. */
  errors: Map<string, string>;
};

export function pageGrids(doc: Doc | null | undefined, data: FormulaData, database: (id: number) => Grid | null): PageGrids {
  const tables: { name: string; pos: number; node: DocNode; cells: PageTable["rows"] }[] = [];
  const pipes: { def: PipeDef; at: number }[] = [];
  const codes: { name: string; result: unknown }[] = [];
  const shown: { title: string; of: string }[] = [];
  let counter = 0;
  let last = "";
  const refs = new Set<string>();
  const walk = (n: DocNode) => {
    if (n.type === "table") {
      const name = String(n.attrs?.name ?? "").trim();
      const rows = (n.content ?? []).map((row) => (row.content ?? []).map((cell) => ({ text: cellText(cell), pos: ++counter, size: 1, header: cell.type === "tableHeader" })));
      tables.push({ name, pos: tables.length, node: n, cells: rows });
      if (name) last = name;
      return;
    }
    if (n.type === "tablePipe") {
      const raw = String(n.attrs?.from ?? "").trim();
      const from = raw === "@above" ? last : raw;
      const name = String(n.attrs?.name ?? "").trim();
      pipes.push({ def: { name, from, steps: stepsFromText(n.attrs?.steps) }, at: pipes.length });
      refs.add(from);
      if (name) last = name;
      return;
    }
    if (n.type === "pipeResult") {
      // A result table with a title is a table of the page by that title: what it shows, as it shows it.
      const raw = String(n.attrs?.of ?? "").trim();
      const title = String(n.attrs?.title ?? "").trim();
      const of = raw === "@above" ? last : raw;
      if (title && of) shown.push({ title, of });
      refs.add(of);
      return;
    }
    if (n.type === "codeCell") {
      const name = String(n.attrs?.name ?? "").trim();
      let result: unknown;
      try {
        result = n.attrs?.result ? (JSON.parse(String(n.attrs.result)) as unknown) : undefined;
      } catch {
        result = undefined;
      }
      if (name) {
        codes.push({ name, result });
        last = name;
      }
      return;
    }
    for (const c of n.content ?? []) walk(c);
  };
  for (const n of doc?.content ?? []) walk(n);

  const pageTables: PageTable[] = tables.map((t) => ({ name: t.name, pos: t.pos, rows: t.cells }));
  const results = evaluatePageTables(pageTables, data, []);
  const grids: PageGrid[] = tables.map((t) => {
    const hasHead = !!t.cells[0]?.length && t.cells[0].every((c) => c.header);
    const width = Math.max(0, ...t.cells.map((r) => r.length));
    const cols = Array.from({ length: width }, (_, i) => (hasHead ? t.cells[0][i]?.text.trim() : "") || String.fromCharCode(65 + (i % 26)) + (i >= 26 ? Math.floor(i / 26) : ""));
    const value = (c: PageTable["rows"][number][number] | undefined): Cell => {
      if (!c) return null;
      if (c.text.trimStart().startsWith("=")) {
        const r = results.get(c.pos);
        if (!r) return null;
        if (r.error) return `#ERR ${r.error}`;
        return r.value as Cell;
      }
      return typed(c.text);
    };
    const body = (hasHead ? t.cells.slice(1) : t.cells).map((r) => Array.from({ length: width }, (_, i) => value(r[i])));
    return { name: t.name, grid: { cols, rows: body } };
  });

  const external: Record<string, Grid> = {};
  for (const r of refs) {
    const m = /^db:(\d+)$/.exec(r);
    const g = m ? database(Number(m[1])) : null;
    if (g) external[r.toLowerCase()] = g;
  }
  const outcomes = evaluatePipes(grids, pipes.map((p) => p.def), external);

  const byName = new Map<string, Grid>();
  const names: PageGrids["names"] = [];
  const errors = new Map<string, string>();
  const values = new Map<string, unknown>();
  for (const c of codes) {
    const k = c.name.toLowerCase();
    if (byName.has(k) || values.has(k) || c.result === undefined || grids.some((g) => g.name.toLowerCase() === k)) continue;
    const g = asGrid(c.result);
    if (g) byName.set(k, g);
    else values.set(k, c.result);
    names.push({ name: c.name, kind: "code" });
  }
  for (const g of grids) {
    if (!g.name || byName.has(g.name.toLowerCase())) continue;
    byName.set(g.name.toLowerCase(), g.grid);
    names.push({ name: g.name, kind: "table" });
  }
  for (const p of pipes) {
    const k = p.def.name.toLowerCase();
    const o = outcomes.get(k);
    if (!k || !o || byName.has(k)) continue;
    byName.set(k, o.grid);
    names.push({ name: p.def.name, kind: "transform" });
    if (o.error) errors.set(k, o.error);
  }
  for (const r of shown) {
    const k = r.title.toLowerCase();
    const g = outcomes.get(r.of.toLowerCase())?.grid ?? byName.get(r.of.toLowerCase()) ?? external[r.of.toLowerCase()];
    if (!g || byName.has(k)) continue;
    byName.set(k, g);
    names.push({ name: r.title, kind: "table" });
  }
  for (const [k, s] of Object.entries(data.sheets)) {
    if (byName.has(k)) continue;
    byName.set(k, { cols: s.cols, rows: s.rows.map((r) => r.map((c) => (typeof c === "number" || typeof c === "string" ? c : c === null || c === undefined ? null : String(c)))) });
    names.push({ name: k, kind: "shared" });
  }
  return { byName, names, errors, values };
}
