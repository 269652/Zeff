import { FLEX_DEPTH, type FlexItem, type FormDef, type FormItem } from "./form-spec";

/**
 * A form's parts as a tree, for the designer: the steps hold parts, rows and columns (boxes) hold parts too. A list of parts is named
 * by who holds it — a step's id or a box's id. Finding, taking out, putting in (no box into itself, no deeper than FLEX_DEPTH),
 * changing; each returns a new form. Pure; client-safe.
 */

/** Where a part is: the list that holds it (its owner's id), its place there, and the step it is in. */
export type Spot = { owner: string; index: number; step: number };

/** Every list of the form, deepest last: [owner id, its parts, how many boxes deep it is (a step's: 0)]. */
function lists(def: FormDef): [string, FormItem[], number][] {
  const out: [string, FormItem[], number][] = [];
  const walk = (owner: string, items: FormItem[], depth: number) => {
    out.push([owner, items, depth]);
    for (const i of items) if (i.kind === "flex") walk(i.id, i.items, depth + 1);
  };
  for (const s of def.steps) walk(s.id, s.items, 0);
  return out;
}

export const findPart = (def: FormDef, id: string): FormItem | undefined => {
  for (const [, items] of lists(def)) for (const i of items) if (i.id === id) return i;
  return undefined;
};

export function spotOf(def: FormDef, id: string): Spot | null {
  for (const [s, step] of def.steps.entries()) {
    const walk = (owner: string, items: FormItem[]): Spot | null => {
      for (const [index, i] of items.entries()) {
        if (i.id === id) return { owner, index, step: s };
        if (i.kind === "flex") {
          const r = walk(i.id, i.items);
          if (r) return r;
        }
      }
      return null;
    };
    const r = walk(step.id, step.items);
    if (r) return r;
  }
  return null;
}

/** The parts held by `owner` (a step's or a box's id). */
export const partsOf = (def: FormDef, owner: string): FormItem[] | undefined => lists(def).find(([o]) => o === owner)?.[1];
/** How many boxes deep the list of `owner` is (a step's: 0). */
const depthOf = (def: FormDef, owner: string): number => lists(def).find(([o]) => o === owner)?.[2] ?? 0;
/** How many boxes deep a part goes itself (a field: 0, a row of columns: 2). */
const height = (i: FormItem): number => (i.kind === "flex" ? 1 + Math.max(0, ...i.items.map(height)) : 0);
const holds = (box: FormItem, id: string): boolean => box.kind === "flex" && box.items.some((c) => c.id === id || holds(c, id));

/** The form with every list of parts passed through `fn` (the boxes' lists first, then the ones holding them). */
function mapLists(def: FormDef, fn: (owner: string, items: FormItem[]) => FormItem[]): FormDef {
  const walk = (owner: string, items: FormItem[]): FormItem[] => fn(owner, items.map((i) => (i.kind === "flex" ? { ...i, items: walk(i.id, i.items) } : i)));
  return { ...def, steps: def.steps.map((s) => ({ ...s, items: walk(s.id, s.items) })) };
}

/** The form without a part. A box's parts go with it — unless `keepInside`: then they take its place. */
export function removePart(def: FormDef, id: string, keepInside = false): FormDef {
  return mapLists(def, (_, items) => items.flatMap((i) => (i.id !== id ? [i] : keepInside && i.kind === "flex" ? i.items : [])));
}

export const patchPart = (def: FormDef, id: string, patch: Partial<FormItem>): FormDef => mapLists(def, (_, items) => items.map((i) => (i.id === id ? ({ ...i, ...patch } as FormItem) : i)));

/** Whether `item` may go into the list of `owner`: not into itself or a box inside it, and no box deeper than FLEX_DEPTH. */
export function canPlace(def: FormDef, item: FormItem, owner: string): boolean {
  if (owner === item.id || holds(item, owner) || !partsOf(def, owner)) return false;
  return depthOf(def, owner) + height(item) <= FLEX_DEPTH;
}

/** The part put at `index` of the list of `owner` (taken from where it was, when it was on the form). Not allowed: the form as it was. */
export function placePart(def: FormDef, item: FormItem, owner: string, index: number): FormDef {
  if (!canPlace(def, item, owner)) return def;
  const from = spotOf(def, item.id);
  if (from && from.owner === owner && from.index < index) index--;
  const without = from ? removePart(def, item.id) : def;
  return mapLists(without, (o, items) => (o !== owner ? items : [...items.slice(0, Math.max(0, index)), item, ...items.slice(Math.max(0, index))]));
}

/** A new box as the palette makes it: a row starts with two columns (a row of fields is two columns side by side), a column empty. */
export const newBox = (dir: "row" | "col", id: () => string): FlexItem => ({ id: id(), kind: "flex", dir, items: dir === "row" ? [{ id: id(), kind: "flex", dir: "col", items: [] }, { id: id(), kind: "flex", dir: "col", items: [] }] : [] });

/** A part with new ids, its box's parts too (a palette part dropped twice is two parts). */
export const freshIds = (i: FormItem, id: () => string): FormItem => (i.kind === "flex" ? { ...i, id: id(), items: i.items.map((c) => freshIds(c, id)) } : { ...i, id: id() });
