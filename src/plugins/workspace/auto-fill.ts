import { evalFormula, formulaRefs, formulaToStored, type FormulaValue } from "./formula";
import { newProperty, type DbSchema, type Property } from "./model";
import { localDay, localStamp } from "@/lib/dates";

/**
 * Fields filled by themselves (the Workspace): a field with `auto` watches some fields of its row — when one of them changes, its
 * formula is worked out for the row and the result goes in, in the field's own type (a date with the time, a number, a text). It is
 * still a field of its own: set by hand, it keeps that until a watched field changes again. "Record the time when ticked" on a
 * checkbox is one made for you: a date field beside it, `if(prop("Genommen"), now(), "")`. Client-safe.
 */

export type AutoFill = { /** The ids of the fields it watches. */ on: string[]; formula: string };

/** The types a field filled by itself can have: those with a value of their own (not computed, not a link). */
export const AUTO_TYPES: readonly Property["type"][] = ["text", "number", "date", "checkbox", "select", "url", "email", "phone"];

/** The formula of a checkbox's time field: the time it was ticked, none when unticked. */
export const stampFormula = (tick: string): string => `if(prop(${JSON.stringify(tick)}), now(), "")`;

/** A formula's result as the field keeps it: a date with the time when the field has one (also at 0:00), "" as nothing. */
export function autoValue(p: Property, v: FormulaValue): unknown {
  if (v === "" || v === null) return null;
  if (v instanceof Date && p.type === "date") {
    return p.includeTime ? localStamp(v) : localDay(v);
  }
  return formulaToStored(v);
}

/** Works out a field's formula for a row (`value` reads a field by its name). `undefined` when it fails — the field is left as it is. */
export function evalAuto(p: Property, value: (name: string) => unknown, now = new Date()): unknown {
  if (!p.auto?.formula.trim()) return undefined;
  const res = evalFormula(p.auto.formula, { now, prop: value });
  return "error" in res ? undefined : autoValue(p, res.value);
}

/**
 * A schema with the time field of each checkbox that records the time ("Record the time when ticked"): made beside it the first time
 * (named "<checkbox> <at>"), and one from before without a formula given it. `at` is the word ("um").
 */
export function withStamps(schema: DbSchema, at: string): DbSchema {
  let properties = schema.properties;
  for (const tick of schema.properties.filter((p) => p.type === "checkbox" && p.stampTime)) {
    const had = properties.find((x) => x.type === "date" && x.stampOf === tick.id);
    const auto = { on: [tick.id], formula: stampFormula(tick.name) };
    if (had) {
      if (!had.auto) properties = properties.map((x) => (x === had ? { ...x, includeTime: true, auto } : x));
      continue;
    }
    const made: Property = { ...newProperty(`${tick.name} ${at}`, "date"), includeTime: true, stampOf: tick.id, auto };
    const i = properties.findIndex((x) => x.id === tick.id);
    properties = [...properties.slice(0, i + 1), made, ...properties.slice(i + 1)];
    // (Its days logged: the list a daily one — unless it was switched off.)
    if (schema.dayList === undefined) schema = { ...schema, dayList: true };
  }
  return properties === schema.properties ? schema : { ...schema, properties };
}

/** A formula with the fields renamed in it (prop("Old") → prop("New")); `names`: old name → new name. */
export function renameInFormula(src: string, names: Map<string, string>): string {
  let out = src;
  for (const r of formulaRefs(src).reverse()) {
    const to = names.get(r.name);
    if (to !== undefined) out = `${out.slice(0, r.from)}prop(${JSON.stringify(to)})${out.slice(r.to)}`;
  }
  return out;
}

/** A schema whose fields were renamed (against the one before): the formulas naming them follow — the computed ones and those filling a field. */
export function followRenames(before: DbSchema, next: DbSchema): DbSchema {
  const was = new Map(before.properties.map((p) => [p.id, p.name]));
  const names = new Map<string, string>();
  for (const p of next.properties) {
    const old = was.get(p.id);
    if (old !== undefined && old !== p.name && !next.properties.some((q) => q.name === old)) names.set(old, p.name);
  }
  if (!names.size) return next;
  return {
    ...next,
    properties: next.properties.map((p) => ({ ...p, ...(p.formula ? { formula: renameInFormula(p.formula, names) } : {}), ...(p.auto ? { auto: { ...p.auto, formula: renameInFormula(p.auto.formula, names) } } : {}) })),
  };
}
