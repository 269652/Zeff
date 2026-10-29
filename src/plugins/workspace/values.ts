import { getPref, setPref } from "@/lib/prefs";
import { CALC_FNS, filterRows, rollup, type CalcFn } from "./model";
import { getPage, rowsOf } from "./store";

/**
 * Value types (the Workspace plugin): a name every part of Zeff can read ("Fixkosten"), made of columns of databases —
 * "Betrag" in the running rows of "Monatskosten", "Monatlich" in "Abos" — and an aggregate over all their rows (sum by
 * default, settable): sum(Fixkosten). A type keeps only where its values come from (database, view, column), never the
 * values: whoever reads it reads the rows there (the Finances plugin's debt overview lists the items itself). Server only.
 */

export { CALC_FNS, type CalcFn };

/** Where a type's values come from: a column of a database, over the rows a view of it shows (its filter applied). */
export type ValueRef = { dbId: number; viewId: string; propId: string };
type ValueType = { label: string; agg: CalcFn; sources: ValueRef[] };

/** A type, read now: its aggregate over all its sources' rows, and each source with what it adds. */
export type NamedValue = { key: string; label: string; agg: CalcFn; value: number | null; sources: (ValueRef & { text: string; value: number | null })[] };

const PREF = "workspace.valueTypes";
/** (Before types: one source per name, its own calculation.) */
const OLD = "workspace.values";

/** A name as the key it is kept and asked by: "Fixkosten" → "fixkosten". */
export const valueKey = (label: string): string =>
  label
    .trim()
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** The types other parts of Zeff read (the Finances plugin: Fixkosten, Einkommen) — offered first, with their aggregate. */
const KNOWN: { label: string; agg: CalcFn; what: string }[] = [
  { label: "Fixkosten", agg: "sum", what: "monthly fixed costs — the Finances plugin's debt overview counts them in" },
  { label: "Einkommen", agg: "sum", what: "monthly net income — the Finances plugin takes it before what it read off your statements" },
  { label: "Sparrate", agg: "sum", what: "what you put aside each month" },
];

/** The numbers of a column over the rows a view shows — each row with its title. Empty: no such database, view or column. */
export function refRows(ref: ValueRef): { rowId: number; title: string; value: number }[] {
  const d = rowsOf(ref.dbId);
  const view = d?.schema.views.find((v) => v.id === ref.viewId);
  if (!d || !view || !d.schema.properties.some((p) => p.id === ref.propId)) return [];
  return filterRows(d.rows, view.filter, d.schema.properties).flatMap((r) => {
    const v = r.cells[ref.propId];
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
    return Number.isFinite(n) ? [{ rowId: r.id, title: r.title, value: n }] : [];
  });
}

const round = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) / 100 : null);

/** A column's calculation over the rows a view shows (its filter applied). Null: no such database, view or column. */
export function viewCalc(dbId: number, viewId: string, propId: string, fn: CalcFn): number | null {
  const d = rowsOf(dbId);
  const view = d?.schema.views.find((v) => v.id === viewId);
  const prop = d?.schema.properties.find((p) => p.id === propId);
  if (!d || !view || !prop) return null;
  return round(rollup(fn, prop, filterRows(d.rows, view.filter, d.schema.properties).map((r) => r.cells[propId])));
}

/** The types — the single-source values from before taken over as types with one source. */
function stored(): Record<string, ValueType> {
  const types = getPref<Record<string, ValueType>>(PREF, {});
  const old = getPref<Record<string, { label: string; dbId: number; viewId: string; propId: string; fn: CalcFn }>>(OLD, {});
  for (const [key, o] of Object.entries(old)) if (!types[key]) types[key] = { label: o.label, agg: o.fn, sources: [{ dbId: o.dbId, viewId: o.viewId, propId: o.propId }] };
  return types;
}
const save = (types: Record<string, ValueType>) => {
  setPref(PREF, types);
  setPref(OLD, {});
};

const same = (a: ValueRef, b: ValueRef) => a.dbId === b.dbId && a.viewId === b.viewId && a.propId === b.propId;

/**
 * A column made a source of a type ("Fixkosten") — added to the sources it has (each column once). A new type gets its
 * aggregate: the known type's, else `fn`, else sum. The key.
 */
export function publishValue(v: ValueRef & { label: string; fn?: CalcFn }): string {
  const key = valueKey(v.label);
  if (!key) throw new Error("A name, please.");
  if (v.fn && !(CALC_FNS as readonly string[]).includes(v.fn)) throw new Error("Unknown calculation.");
  const types = stored();
  const ref: ValueRef = { dbId: Number(v.dbId), viewId: String(v.viewId), propId: String(v.propId) };
  const had = types[key];
  const known = KNOWN.find((k) => valueKey(k.label) === key);
  types[key] = had ? { ...had, sources: had.sources.some((s) => same(s, ref)) ? had.sources : [...had.sources, ref] } : { label: known?.label ?? v.label.trim(), agg: known?.agg ?? v.fn ?? "sum", sources: [ref] };
  save(types);
  return key;
}

/** A type's aggregate set (sum, average, max …). */
export function setValueAggregate(keyOrLabel: string, fn: CalcFn): void {
  if (!(CALC_FNS as readonly string[]).includes(fn)) throw new Error("Unknown calculation.");
  const types = stored();
  const key = valueKey(keyOrLabel);
  if (!types[key]) throw new Error("No such value.");
  types[key] = { ...types[key], agg: fn };
  save(types);
}

/** A column no longer a source of the type; its last one gone, the type goes. */
export function removeValueSource(keyOrLabel: string, ref: ValueRef): void {
  const types = stored();
  const key = valueKey(keyOrLabel);
  if (!types[key]) return;
  const sources = types[key].sources.filter((s) => !same(s, ref));
  if (sources.length) types[key] = { ...types[key], sources };
  else delete types[key];
  save(types);
}

/** The type gone, all its sources with it. */
export function unpublishValue(keyOrLabel: string): void {
  const types = stored();
  delete types[valueKey(keyOrLabel)];
  save(types);
}

const FORMAT_UNIT: Partial<Record<string, string>> = { euro: "€", dollar: "$", hours: "h" };

/** The unit its columns say (all of them the same: euro → €, hours → h, a unit of their own) — "" when they don't, or it counts rows. */
export function valueUnit(keyOrLabel: string): string {
  const ty = stored()[valueKey(keyOrLabel)];
  if (!ty || ty.agg === "count" || ty.agg === "count_values") return "";
  const units = new Set(
    ty.sources.map((s) => {
      const p = rowsOf(s.dbId)?.schema.properties.find((x) => x.id === s.propId);
      return p?.format === "unit" ? (p.unit?.trim() ?? "") : (FORMAT_UNIT[p?.format ?? ""] ?? "");
    }),
  );
  return units.size === 1 ? [...units][0] : "";
}

/** Where a type's values come from — only the references; whoever reads it reads the rows there (refRows). */
export const valueSources = (keyOrLabel: string): ValueRef[] => stored()[valueKey(keyOrLabel)]?.sources ?? [];

/** The type's aggregate. */
export const valueAggregate = (keyOrLabel: string): CalcFn | null => stored()[valueKey(keyOrLabel)]?.agg ?? null;

const refText = (r: ValueRef): string => {
  const d = rowsOf(r.dbId);
  const view = d?.schema.views.find((v) => v.id === r.viewId);
  const prop = d?.schema.properties.find((p) => p.id === r.propId);
  return `${getPage(r.dbId)?.title || "?"} · ${view?.name ?? "?"} · ${prop?.name ?? "?"}`;
};

/** A type read now (by its name or key): its aggregate over all its sources' rows. Null: no such type. */
export function namedValue(keyOrLabel: string): NamedValue | null {
  const key = valueKey(keyOrLabel);
  const ty = stored()[key];
  if (!ty) return null;
  const per = ty.sources.map((s) => ({ ...s, rows: refRows(s) }));
  return {
    key,
    label: ty.label,
    agg: ty.agg,
    value: round(rollup(ty.agg, undefined, per.flatMap((s) => s.rows.map((r) => r.value)))),
    sources: per.map(({ rows, ...s }) => ({ ...s, text: refText(s), value: round(rollup(ty.agg, undefined, rows.map((r) => r.value))) })),
  };
}

/** Every type, read now. */
export const listNamedValues = (): NamedValue[] => Object.keys(stored()).map((k) => namedValue(k)!).filter(Boolean);

/** The names to pick from: the types Zeff reads, then the ones made — each with whether it has sources yet. */
export function valueNameSuggestions(): { key: string; label: string; what: string; taken: boolean }[] {
  const have = stored();
  const out = KNOWN.map((k) => ({ key: valueKey(k.label), label: k.label, what: k.what, taken: !!have[valueKey(k.label)] }));
  for (const [key, s] of Object.entries(have)) if (!out.some((o) => o.key === key)) out.push({ key, label: s.label, what: "", taken: true });
  return out;
}
