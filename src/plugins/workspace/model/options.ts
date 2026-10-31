import { type Row, type Property, choiceColor, type DbSchema, type Option } from "./schema";
import { type Labels, noLabels, dateRange, asArray, optionName } from "./values";
import { propOrVirtual, cellOf } from "./filters";

// ---------------------------------------------------------------------------
// Grouping (board columns, table groups)
// ---------------------------------------------------------------------------

export type Group = { key: string; label: string; color?: string; rows: Row[] };

/** Rows in groups by a property: a column per option (in their order, empty ones too), a "No value" last. */
export function groupRows(rows: Row[], groupBy: string, props: Property[], labels: Labels = noLabels): Group[] {
  const p = propOrVirtual(props, groupBy);
  if (!p) return [{ key: "", label: "", rows }];
  const groups = new Map<string, Group>();
  const ensure = (key: string, label: string, color?: string) => {
    if (!groups.has(key)) groups.set(key, { key, label, color, rows: [] });
    return groups.get(key)!;
  };
  if (p.type === "select" || p.type === "status" || p.type === "multi_select") for (const o of p.options ?? []) ensure(o.id, o.name, o.color);
  // An AI column with choices: its choices are the groups, in their order, each with its colour (a board's columns).
  const aiChoices = p.type === "ai" && p.aiChoices?.length ? p.aiChoices : null;
  if (aiChoices) for (const c of aiChoices) ensure(c, c, choiceColor(p, c));
  if (p.type === "checkbox") {
    ensure("true", "Checked");
    ensure("false", "Not checked");
  }
  const none = { key: "", label: "No value" } as Group;
  none.rows = [];
  for (const r of rows) {
    const v = cellOf(r, groupBy);
    if (p.type === "checkbox") {
      ensure(v ? "true" : "false", "").rows.push(r);
      continue;
    }
    const values = p.type === "date" ? (dateRange(v) ? [dateRange(v)!.start.slice(0, 7)] : []) : asArray(v).filter((x) => x !== "" && x !== null);
    if (!values.length) none.rows.push(r);
    for (const x of values) {
      const key = String(x);
      const label = p.type === "select" || p.type === "status" || p.type === "multi_select" ? optionName(p, x) : p.type === "person" ? labels.person(Number(x)) : p.type === "relation" ? labels.page(Number(x)) : p.type === "todo" ? labels.todo(Number(x)) : key;
      if (!(p.type === "select" || p.type === "status" || p.type === "multi_select") || groups.has(key)) ensure(key, label, groups.get(key)?.color).rows.push(r);
      else none.rows.push(r);
    }
  }
  const list = [...groups.values()];
  if (!(p.type === "select" || p.type === "status" || p.type === "multi_select" || p.type === "checkbox" || aiChoices)) list.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  return none.rows.length || !list.length ? [...list, none] : list;
}

/**
 * What a row's grouped property becomes when its card is dropped from column `from` into column `to`
 * (keys as groupRows makes them; "" is No value): a single value is replaced; a multi value (tags,
 * people, relations) only swaps the column it came from — its other values stay.
 */
export function dropValue(p: Property, current: unknown, from: string, to: string): unknown {
  if (p.type === "checkbox") return to === "true";
  if (p.type === "multi_select" || p.type === "person" || p.type === "relation") {
    const key = (k: string): unknown => (p.type === "multi_select" ? k : Number(k));
    const kept = asArray(current).filter((x) => x !== null && x !== "" && String(x) !== from);
    const next = to === "" || kept.some((x) => String(x) === to) ? kept : [...kept, key(to)];
    return next.length ? next : null;
  }
  return to === "" ? null : to;
}

// ---------------------------------------------------------------------------
// A board's columns, edited on the board (the options of the property it groups by)
// ---------------------------------------------------------------------------

const withOptions = (schema: DbSchema, propId: string, fn: (o: Option[]) => Option[]): DbSchema => ({
  ...schema,
  properties: schema.properties.map((p) => (p.id === propId ? { ...p, options: fn(p.options ?? []) } : p)),
});

/** A column one place left (-1) or right (1); at the edge it stays. */
export function moveOption(schema: DbSchema, propId: string, optionId: string, dir: -1 | 1): DbSchema {
  return withOptions(schema, propId, (o) => {
    const i = o.findIndex((x) => x.id === optionId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= o.length) return o;
    const next = [...o];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
}

/** A column dragged in front of another (`before`; null: to the end); onto itself it stays. */
export function moveOptionTo(schema: DbSchema, propId: string, optionId: string, before: string | null): DbSchema {
  if (optionId === before) return schema;
  return withOptions(schema, propId, (o) => {
    const moved = o.find((x) => x.id === optionId);
    if (!moved) return o;
    const rest = o.filter((x) => x.id !== optionId);
    const at = before === null ? rest.length : rest.findIndex((x) => x.id === before);
    rest.splice(at < 0 ? rest.length : at, 0, moved);
    return rest;
  });
}

/** A column renamed (an empty name changes nothing). */
export const renameOption = (schema: DbSchema, propId: string, optionId: string, name: string): DbSchema =>
  name.trim() ? withOptions(schema, propId, (o) => o.map((x) => (x.id === optionId ? { ...x, name: name.trim() } : x))) : schema;

/** A status column that counts as done (its cards are done), or not any more (then: doing). */
export const setOptionDone = (schema: DbSchema, propId: string, optionId: string, done: boolean): DbSchema =>
  withOptions(schema, propId, (o) => o.map((x) => (x.id === optionId ? { ...x, group: done ? ("done" as const) : x.group === "done" ? ("doing" as const) : x.group } : x)));

/** A column's WIP limit on a board view (null: none). */
export function setWipLimit(schema: DbSchema, viewId: string, optionId: string, limit: number | null): DbSchema {
  return {
    ...schema,
    views: schema.views.map((v) => {
      if (v.id !== viewId) return v;
      const wip = { ...(v.wip ?? {}) };
      if (limit && limit > 0) wip[optionId] = Math.floor(limit);
      else delete wip[optionId];
      return { ...v, wip };
    }),
  };
}

/** A column removed — only when no card is in it (they'd lose their place). */
export function removeOption(schema: DbSchema, propId: string, optionId: string, rows: Row[]): DbSchema {
  const n = rows.filter((r) => asArray(r.cells[propId]).includes(optionId)).length;
  if (n) throw new Error(`The column still has ${n} card${n === 1 ? "" : "s"} — move them first.`);
  return withOptions(schema, propId, (o) => o.filter((x) => x.id !== optionId));
}
