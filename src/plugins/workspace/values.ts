import { getPref, setPref } from "@/lib/prefs";
import { CALC_FNS, filterRows, rollup, type CalcFn } from "./model";
import { getPage, rowsOf } from "./store";

/**
 * Named values (the Workspace plugin): a column's calculation in a view of a database — the sum of "Betrag" over the running
 * rows of "Monatskosten" — published under a name ("Fixkosten") that every part of Zeff can read, live: the Finances plugin's
 * debt overview counts it in. One value per name; the name picked from those Zeff knows, or a new one. Server only.
 */

export { CALC_FNS, type CalcFn };

export type ValueSource = { label: string; dbId: number; viewId: string; propId: string; fn: CalcFn };
export type NamedValue = { key: string; label: string; value: number | null; source: string; dbId: number; viewId: string; propId: string; fn: CalcFn };

const PREF = "workspace.values";

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

/** The names other parts of Zeff read (the Finances plugin: Fixkosten, Einkommen) — offered first when a value is named. */
const KNOWN: { label: string; what: string }[] = [
  { label: "Fixkosten", what: "monthly fixed costs — the Finances plugin's debt overview counts them in" },
  { label: "Einkommen", what: "monthly net income — the Finances plugin takes it before what it read off your statements" },
  { label: "Sparrate", what: "what you put aside each month" },
];

/** A column's calculation over the rows a view shows (its filter applied). Null: no such database, view or column. */
export function viewCalc(dbId: number, viewId: string, propId: string, fn: CalcFn): number | null {
  const d = rowsOf(dbId);
  const view = d?.schema.views.find((v) => v.id === viewId);
  const prop = d?.schema.properties.find((p) => p.id === propId);
  if (!d || !view || !prop) return null;
  const rows = filterRows(d.rows, view.filter, d.schema.properties);
  const v = rollup(fn, prop, rows.map((r) => r.cells[propId]));
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
}

const stored = (): Record<string, ValueSource> => getPref<Record<string, ValueSource>>(PREF, {});

/** A calculation published under a name — one per name: a new source for a name replaces the one before. */
export function publishValue(v: ValueSource): string {
  const key = valueKey(v.label);
  if (!key) throw new Error("A name, please.");
  if (!(CALC_FNS as readonly string[]).includes(v.fn)) throw new Error("Unknown calculation.");
  setPref(PREF, { ...stored(), [key]: { ...v, label: v.label.trim() } });
  return key;
}

export function unpublishValue(keyOrLabel: string): void {
  const all = stored();
  delete all[valueKey(keyOrLabel)];
  setPref(PREF, all);
}

const sourceText = (s: ValueSource): string => {
  const d = rowsOf(s.dbId);
  const view = d?.schema.views.find((v) => v.id === s.viewId);
  const prop = d?.schema.properties.find((p) => p.id === s.propId);
  return `${getPage(s.dbId)?.title || "?"} · ${view?.name ?? "?"} · ${s.fn}(${prop?.name ?? "?"})`;
};

/** A published value, computed now (by its name or its key). Null: none under that name. */
export function namedValue(keyOrLabel: string): NamedValue | null {
  const key = valueKey(keyOrLabel);
  const s = stored()[key];
  if (!s) return null;
  return { key, label: s.label, value: viewCalc(s.dbId, s.viewId, s.propId, s.fn), source: sourceText(s), dbId: s.dbId, viewId: s.viewId, propId: s.propId, fn: s.fn };
}

/** Every published value, computed now. */
export const listNamedValues = (): NamedValue[] => Object.keys(stored()).map((k) => namedValue(k)!).filter(Boolean);

/** The names to pick from: the ones Zeff reads, then the ones already published — each with whether it is taken. */
export function valueNameSuggestions(): { key: string; label: string; what: string; taken: boolean }[] {
  const have = stored();
  const out = KNOWN.map((k) => ({ key: valueKey(k.label), label: k.label, what: k.what, taken: !!have[valueKey(k.label)] }));
  for (const [key, s] of Object.entries(have)) if (!out.some((o) => o.key === key)) out.push({ key, label: s.label, what: "", taken: true });
  return out;
}
