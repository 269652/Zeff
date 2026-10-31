import { evalFormula, evalWithUnits, formulaToStored, type FormulaSheet, type FormulaValue } from "../formula";
import { conversion, numberWithUnit, parseUnit } from "../units";
import { type DbSchema, type Row, type RollupFn, type Property, isComputed, TITLE, TICKET_KEY, propById } from "./schema";
import { isEmptyValue, dateRange, hasCellFormulas, asArray, cellFormula, sheetColumns, columnUnit } from "./values";
import { ids } from "./util";
import { filterRows } from "./filters";

// ---------------------------------------------------------------------------
// Computed properties
// ---------------------------------------------------------------------------

/** What another database offers a rollup: its schema and its rows (stored values). */
/** (a lookup of databases only may take just a number: the key is a string for a source.) */
export type DbLookup = { bivarianceHack(dbId: number | string): { schema: DbSchema; rows: Row[] } | null }["bivarianceHack"];

const num = (v: unknown): number | null => (typeof v === "number" && !Number.isNaN(v) ? v : typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)) ? Number(v) : null);

/** A rollup over the values of the related rows' property. */
export function rollup(fn: RollupFn, target: Property | undefined, values: unknown[]): unknown {
  const flat = values.flatMap((v) => (Array.isArray(v) ? v : [v]));
  const present = flat.filter((v) => !isEmptyValue(target, v));
  const nums = present.map(num).filter((n): n is number => n !== null);
  switch (fn) {
    case "count":
      return values.length;
    case "count_values":
      return present.length;
    case "count_unique":
      return new Set(present.map((v) => JSON.stringify(v))).size;
    case "count_empty":
      return values.length - values.filter((v) => !isEmptyValue(target, v)).length;
    case "count_not_empty":
      return values.filter((v) => !isEmptyValue(target, v)).length;
    case "percent_empty":
      return values.length ? (values.length - values.filter((v) => !isEmptyValue(target, v)).length) / values.length : null;
    case "percent_not_empty":
      return values.length ? values.filter((v) => !isEmptyValue(target, v)).length / values.length : null;
    case "sum":
      return nums.reduce((a, b) => a + b, 0);
    case "average":
      return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
    case "median": {
      if (!nums.length) return null;
      const s = [...nums].sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    }
    case "min":
      return nums.length ? Math.min(...nums) : null;
    case "max":
      return nums.length ? Math.max(...nums) : null;
    case "range":
      return nums.length ? Math.max(...nums) - Math.min(...nums) : null;
    case "earliest":
    case "latest": {
      const ds = present.map((v) => dateRange(v)?.start).filter((s): s is string => !!s).sort();
      return ds.length ? (fn === "earliest" ? ds[0] : ds[ds.length - 1]) : null;
    }
    case "show_original":
      return present;
    case "show_unique":
      return [...new Map(present.map((v) => [JSON.stringify(v), v])).values()];
    case "checked":
      return values.filter(Boolean).length;
    case "unchecked":
      return values.filter((v) => !v).length;
    case "percent_checked":
      return values.length ? values.filter(Boolean).length / values.length : null;
    case "percent_done":
      // Of a status property: how many sit in an option of the "done" group.
      return values.length ? values.filter((v) => target?.options?.find((o) => o.id === v)?.group === "done").length / values.length : null;
  }
}

/**
 * The rows with their computed cells filled in: back relations (the rows of the other database that point
 * here), rollups through relations, formulas (which may use the others), created/edited times. Stored
 * values are left as they are. A formula that fails gets its message in `cells[id + "!"]`.
 */
export function computeRows(schema: DbSchema, rows: Row[], lookup: DbLookup, selfId: number, depth = 0, now = new Date(), byName?: (name: string) => number | null): Row[] {
  const props = schema.properties;
  const cellFormulas = hasCellFormulas(rows);
  if (!props.some(isComputed) && !cellFormulas) return rows;
  const byRow = new Map<number, Row>();
  const out = rows.map((r) => {
    const copy: Row = { ...r, cells: { ...r.cells } };
    byRow.set(copy.id, copy);
    return copy;
  });
  // Related databases, computed once (a rollup of a formula there needs it computed; deeper than 2 is left null).
  const related = new Map<number | string, { schema: DbSchema; rows: Row[] } | null>();
  const other = (dbId: number | string) => {
    if (!related.has(dbId)) {
      const d = dbId === selfId ? { schema, rows } : lookup(dbId);
      related.set(dbId, d);
    }
    return related.get(dbId) ?? null;
  };
  const computedOther = new Map<number | string, Row[]>();
  /** What a relation points at: its database, or its source. */
  const relKey = (p: Property): number | string | undefined => p.relationSource ?? p.relationDb;
  const rowsOf = (dbId: number | string, needComputed: boolean): Row[] => {
    const d = other(dbId);
    if (!d) return [];
    if (!needComputed || depth >= 2 || dbId === selfId || typeof dbId === "string") return dbId === selfId ? out : d.rows;
    if (!computedOther.has(dbId)) computedOther.set(dbId, computeRows(d.schema, d.rows, lookup, dbId, depth + 1, now));
    return computedOther.get(dbId)!;
  };

  // 1. Back relations.
  for (const p of props) {
    if (p.type !== "relation" || !p.backOf || p.relationDb === undefined) continue;
    const d = other(p.relationDb);
    for (const r of out) r.cells[p.id] = (d?.rows ?? []).filter((x) => asArray(x.cells[p.backOf!]).some((id) => Number(id) === r.id)).map((x) => x.id);
  }
  // 1b. Matching relations: the rows of the other database whose value equals this row's (case and edge spaces don't count).
  const keys = (v: unknown): string[] => asArray(v).map((x) => String(x ?? "").trim().toLowerCase()).filter(Boolean);
  for (const p of props) {
    if (p.type !== "relation" || p.backOf || !p.match || relKey(p) === undefined) continue;
    const { from, to } = p.match;
    const d = relKey(p) === selfId ? { schema, rows: out } : other(relKey(p)!);
    const index = new Map<string, number[]>();
    for (const x of d?.rows ?? []) for (const k of keys(to === TITLE ? x.title : x.cells[to])) index.set(k, [...(index.get(k) ?? []), x.id]);
    // (A ticket's row is named by its key: "title" also tries the Key cell — Jira rows keep the summary as their title.)
    for (const r of out) r.cells[p.id] = [...new Set(keys(from === TITLE ? [r.title, r.cells[TICKET_KEY]] : r.cells[from]).flatMap((k) => index.get(k) ?? []))];
  }
  // 2. Rollups, 3. formulas (by property, memoised; a formula may use a rollup or another formula).
  const done = new Set<string>();
  const busy = new Set<string>();
  const valueOf = (row: Row, p: Property): unknown => {
    if (p.id === TITLE) return row.title;
    if (p.type === "created_time") return row.createdAt;
    if (p.type === "updated_time") return row.updatedAt;
    if (p.type === "formula" || p.type === "rollup" || cellFormula(row, p.id)) ensure(row, p);
    return row.cells[p.id];
  };
  // The table as a spreadsheet (a cell's formula: A1, B:B, [Betrag]) — and the tables shared for formulas, by their name.
  const columns = sheetColumns(schema).map((id) => (id === TITLE ? ({ id: TITLE, name: schema.titleName, type: "text" } as Property) : propById(props, id))).filter((p): p is Property => !!p);
  const colIndexIn = (cols: Property[], titleName: string) => (name: string) => {
    const n = name.trim().toLowerCase();
    return cols.findIndex((p) => p.name.toLowerCase() === n || (p.id === TITLE && (n === "title" || n === titleName.toLowerCase())));
  };
  /** A cell's unit: its formula's (worked out), its column's, or what its text says ("12 €"). */
  const unitIn = (row: Row | undefined, p: Property | undefined, value: () => unknown): string | null => {
    if (!row || !p) return null;
    const v = value();
    const own = row.cells[`${p.id}~`];
    if (typeof own === "string" && own) return own;
    return columnUnit(p) ?? (typeof v === "string" ? numberWithUnit(v)?.label || null : null);
  };
  const ownSheet = (rowAt: number): FormulaSheet => ({
    rows: out.length,
    cols: columns.length,
    cell: (c, r) => (out[r] && columns[c] ? valueOf(out[r], columns[c]) : null),
    unit: (c, r) => unitIn(out[r], columns[c], () => (out[r] && columns[c] ? valueOf(out[r], columns[c]) : null)),
    colIndex: colIndexIn(columns, schema.titleName),
    row: rowAt,
  });
  const shared = new Map<string, FormulaSheet | null>();
  const sheetNamed = (name: string): FormulaSheet | null => {
    const key = name.trim().toLowerCase();
    if (shared.has(key)) return shared.get(key)!;
    shared.set(key, null);
    const id = byName?.(name) ?? null;
    let sheet: FormulaSheet | null = null;
    if (id === selfId) sheet = { ...ownSheet(0), row: undefined };
    else if (id !== null && depth < 2) {
      const d = lookup(id);
      if (d) {
        const theirs = computeRows(d.schema, d.rows, lookup, id, depth + 1, now, byName);
        const cols = sheetColumns(d.schema).map((x) => (x === TITLE ? ({ id: TITLE, name: d.schema.titleName, type: "text" } as Property) : propById(d.schema.properties, x))).filter((p): p is Property => !!p);
        const at = (c: number, r: number) => (!theirs[r] || !cols[c] ? null : cols[c].id === TITLE ? theirs[r].title : theirs[r].cells[cols[c].id]);
        sheet = { rows: theirs.length, cols: cols.length, cell: at, unit: (c, r) => unitIn(theirs[r], cols[c], () => at(c, r)), colIndex: colIndexIn(cols, d.schema.titleName) };
      }
    }
    shared.set(key, sheet);
    return sheet;
  };
  const ensure = (row: Row, p: Property) => {
    const key = `${row.id}:${p.id}`;
    if (done.has(key)) return;
    if (busy.has(key)) {
      row.cells[`${p.id}!`] = "Circular formula";
      return;
    }
    busy.add(key);
    try {
      if (p.type === "rollup" && p.rollup) {
        const rel = propById(props, p.rollup.relation);
        const ids = asArray(rel ? valueOf(row, rel) : null).map(Number);
        const key = rel ? relKey(rel) : undefined;
        const d = key !== undefined ? other(key) : null;
        const target = d ? propById(d.schema.properties, p.rollup.property) : undefined;
        const filter = p.rollup.filter?.rules.length ? p.rollup.filter : undefined;
        const base = key !== undefined ? rowsOf(key, (!!target && isComputed(target)) || !!filter) : [];
        const pool = filter && d ? filterRows(base, filter, d.schema.properties) : base;
        const picked = ids.map((id) => pool.find((x) => x.id === id)).filter((x): x is Row => !!x);
        const cellsOf = picked.map((x) => (p.rollup!.property === TITLE ? x.title : x.cells[p.rollup!.property]));
        row.cells[p.id] = rollup(p.rollup.fn, p.rollup.property === TITLE ? { id: TITLE, name: "Title", type: "text" } : target, cellsOf);
      } else if (cellFormula(row, p.id)) {
        // A cell's own formula: its table as cells, the shared tables by name, the Kennzahlen.
        const at = out.indexOf(row);
        const res = evalWithUnits(cellFormula(row, p.id)!.trim().replace(/^=/, ""), {
          now,
          prop: (name) => {
            const q = props.find((x) => x.name.toLowerCase() === name.toLowerCase());
            if (!q) throw new Error(`No property "${name}"`);
            return valueOf(row, q);
          },
          sheet: (name) => (name === null ? ownSheet(at) : sheetNamed(name)),
        });
        if ("error" in res) {
          row.cells[p.id] = null;
          row.cells[`${p.id}!`] = res.error;
        } else {
          // Its unit: into the column's (converted — min into h), or said when it doesn't fit; a column without one shows the result's.
          const warnings = [...res.warnings];
          const colUnit = columnUnit(p);
          if (res.unit && colUnit) {
            const f = conversion(parseUnit(res.unit), parseUnit(colUnit));
            if (f === null) warnings.push(`The column is in ${colUnit} — the formula gives ${res.unit}`);
            else if (f !== 1 && typeof res.value === "number") res.value = res.value * f;
          } else if (res.unit) row.cells[`${p.id}~`] = res.unit;
          if (warnings.length) row.cells[`${p.id}?`] = warnings.join("; ");
          const v = formulaToStored(res.value as FormulaValue);
          if (p.type === "number" && Array.isArray(v)) {
            row.cells[p.id] = null;
            row.cells[`${p.id}!`] = "A range gives many values — sum it: SUMME(…)";
          } else if (p.type === "number" && v !== null && typeof v !== "number") {
            // (a number column shows numbers: a text or yes/no is said — a text column can show it)
            row.cells[p.id] = null;
            row.cells[`${p.id}!`] = `Gives “${String(v)}” — not a number`;
          } else row.cells[p.id] = Array.isArray(v) ? v.join(", ") : v;
        }
      } else if (p.type === "formula") {
        const at = out.indexOf(row);
        const res = evalFormula(p.formula ?? "", {
          now,
          // (a column's formula reads the table as cells too: [Betrag] * 2, SUMME(B:B), Kosten!B2)
          sheet: (name) => (name === null ? ownSheet(at) : sheetNamed(name)),
          prop: (name) => {
            const q = props.find((x) => x.name.toLowerCase() === name.toLowerCase()) ?? (name.toLowerCase() === schema.titleName.toLowerCase() || name.toLowerCase() === "title" ? { id: TITLE, name, type: "text" as const } : undefined);
            if (!q) throw new Error(`No property "${name}"`);
            return valueOf(row, q);
          },
        });
        if ("error" in res) {
          row.cells[p.id] = null;
          row.cells[`${p.id}!`] = res.error;
        } else row.cells[p.id] = formulaToStored(res.value as FormulaValue);
      }
    } finally {
      busy.delete(key);
      done.add(key);
    }
  };
  for (const p of props) if (p.type === "rollup") for (const r of out) ensure(r, p);
  for (const p of props) if (p.type === "formula") for (const r of out) ensure(r, p);
  if (cellFormulas) for (const p of props) for (const r of out) if (cellFormula(r, p.id)) ensure(r, p);
  for (const p of props) {
    if (p.type === "created_time") for (const r of out) r.cells[p.id] = r.createdAt;
    if (p.type === "updated_time") for (const r of out) r.cells[p.id] = r.updatedAt;
  }
  return out;
}
