/**
 * Changing a database's schema by name, the way an agent (or a script) says it: add, change and remove properties, views and
 * the order of columns — "Status", "Board", "title" instead of ids. Pure over a DbSchema; the caller saves the result. Server-safe.
 */
import { COLORS, columnOrder, emptyFilter, moveBefore, newId, newProperty, removeProperty, newView, PROP_TYPES, ROLLUP_FNS, TITLE, VIEW_TYPES, type Cond, type DbSchema, type Filter, type Option, type Property, type PropType, type Rule, type RollupFn, type Sort, type View, type ViewType } from "./model";

export type OptionIn = string | { name: string; color?: string; group?: "todo" | "doing" | "done" };

/** A property as an agent says it. `relation.database` is a database's page id; `rollup` names properties (of this database, and of the related one). */
export type PropIn = {
  name?: string;
  type?: string;
  options?: OptionIn[];
  formula?: string;
  /** custom: the id of the field type ("workspace.rating", "workspace.progress", a plugin's "plugin.what"). */
  custom?: string;
  aiPrompt?: string;
  format?: "number" | "percent" | "euro" | "dollar" | "hours";
  includeTime?: boolean;
  relation?: { database: number; twoWay?: boolean };
  rollup?: { relation: string; property: string; fn: string };
};

export type FilterIn = { property: string; cond: string; value?: unknown };
export type SortIn = { property: string; dir?: "asc" | "desc" };
/** A view as an agent says it: properties by name ("title" is the title column). `filter` rules are all required (and). */
export type ViewIn = { name?: string; type?: string; groupBy?: string | null; dateProp?: string | null; endProp?: string | null; chartKind?: string; chartCalc?: string; chartProp?: string | null; hidden?: string[]; order?: string[]; sorts?: SortIn[]; filter?: FilterIn[]; wrap?: boolean };

export type DbOp =
  | ({ op: "add_property"; name: string; position?: number } & PropIn)
  | ({ op: "update_property"; property: string } & PropIn)
  | { op: "remove_property"; property: string }
  | { op: "rename_title"; name: string }
  | { op: "reorder_properties"; names: string[] }
  | ({ op: "add_view"; name: string } & ViewIn)
  | ({ op: "update_view"; view: string } & ViewIn)
  | { op: "remove_view"; view: string }
  | { op: "order_columns"; view?: string; order: string[] };

export type OpsContext = { /** The schema of another database (for rollups through a relation). */ related: (dbId: number) => DbSchema | null };

const lc = (s: unknown) => String(s ?? "").trim().toLowerCase();

function prop(schema: DbSchema, ref: string, what = "property"): Property {
  const p = schema.properties.find((x) => x.id === ref) ?? schema.properties.find((x) => lc(x.name) === lc(ref));
  if (!p) throw new Error(`No ${what} "${ref}" — there are: ${schema.properties.map((x) => x.name).join(", ") || "none"}.`);
  return p;
}

function viewOf(schema: DbSchema, ref: string): View {
  const v = schema.views.find((x) => x.id === ref) ?? schema.views.find((x) => lc(x.name) === lc(ref));
  if (!v) throw new Error(`No view "${ref}" — there are: ${schema.views.map((x) => x.name).join(", ")}.`);
  return v;
}

const options = (list: OptionIn[], status: boolean, keep: Option[] = []): Option[] =>
  list.map((o, i) => {
    const name = typeof o === "string" ? o : o.name;
    const old = keep.find((k) => lc(k.name) === lc(name));
    const color = typeof o === "string" ? undefined : o.color;
    const group = typeof o === "string" ? undefined : o.group;
    return {
      id: old?.id ?? newId("o"),
      name,
      color: color && (COLORS as readonly string[]).includes(color) ? color : (old?.color ?? COLORS[(i + 1) % COLORS.length]),
      ...(status ? { group: group ?? old?.group ?? "todo" } : {}),
    };
  });

/** A property filled from what was said (`into`: the one to change - a new one is made from the name and type). */
function fillProperty(schema: DbSchema, into: Property, v: PropIn, ctx: OpsContext): Property {
  const p: Property = { ...into };
  if (v.name !== undefined && v.name.trim()) p.name = v.name.trim();
  if (v.type !== undefined) {
    if (!(PROP_TYPES as readonly string[]).includes(v.type)) throw new Error(`Unknown property type "${v.type}" — types: ${PROP_TYPES.join(", ")}.`);
    p.type = v.type as PropType;
  }
  const sel = p.type === "select" || p.type === "multi_select" || p.type === "status";
  if (sel) {
    if (v.options) p.options = options(v.options, p.type === "status", p.options);
    else if (!p.options) p.options = p.type === "status" ? options(["Not started", "In progress", "Done"].map((n, i) => ({ name: n, group: (["todo", "doing", "done"] as const)[i] })), true) : [];
  } else delete p.options;
  if (v.formula !== undefined) p.formula = v.formula;
  if (v.custom !== undefined) p.custom = v.custom.trim() || undefined;
  if (p.type !== "custom") delete p.custom;
  if (v.aiPrompt !== undefined) p.aiPrompt = v.aiPrompt;
  if (v.format !== undefined) p.format = v.format;
  if (v.includeTime !== undefined) p.includeTime = v.includeTime;
  if (v.relation) {
    p.relationDb = v.relation.database;
    p.twoWay = !!v.relation.twoWay;
  }
  if (v.rollup) {
    const rel = prop(schema, v.rollup.relation, "relation");
    if (rel.type !== "relation" || rel.relationDb === undefined) throw new Error(`"${rel.name}" is not a relation — a rollup goes through one.`);
    const other = ctx.related(rel.relationDb);
    const target = v.rollup.property === TITLE || lc(v.rollup.property) === "title" ? TITLE : other?.properties.find((x) => x.id === v.rollup!.property || lc(x.name) === lc(v.rollup!.property))?.id;
    if (!target) throw new Error(`The related database has no property "${v.rollup.property}".`);
    if (!(ROLLUP_FNS as readonly string[]).includes(v.rollup.fn)) throw new Error(`Unknown rollup function "${v.rollup.fn}" — ${ROLLUP_FNS.join(", ")}.`);
    p.rollup = { relation: rel.id, property: target, fn: v.rollup.fn as RollupFn };
  }
  if (p.type === "formula" && !p.formula) throw new Error(`The formula property "${p.name}" needs a formula.`);
  if (p.type === "rollup" && !p.rollup) throw new Error(`The rollup property "${p.name}" needs a rollup (relation, property, fn).`);
  if (p.type === "relation" && !p.backOf && p.relationDb === undefined) throw new Error(`The relation property "${p.name}" needs relation.database.`);
  return p;
}

const COND_ALIASES: Record<string, Cond> = { "=": "is", "==": "is", "!=": "is_not", ">": "gt", "<": "lt", ">=": "gte", "<=": "lte", equals: "is" };

function ruleOf(schema: DbSchema, f: FilterIn): Rule {
  const prop0 = lc(f.property) === "title" || f.property === TITLE ? undefined : prop(schema, f.property);
  const cond = (COND_ALIASES[f.cond] ?? f.cond) as Cond;
  let value = f.value;
  // Options are told by name, kept by id.
  if (prop0 && (prop0.type === "select" || prop0.type === "status" || prop0.type === "multi_select") && typeof value === "string") {
    value = prop0.options?.find((o) => lc(o.name) === lc(value))?.id ?? value;
  }
  return { prop: prop0?.id ?? TITLE, cond, ...(value !== undefined ? { value } : {}) };
}

/** The ids of a list of names ("title" = the title column). */
function ids(schema: DbSchema, names: string[]): string[] {
  return names.map((n) => (lc(n) === "title" || n === TITLE ? TITLE : prop(schema, n).id));
}

function fillView(schema: DbSchema, into: View, v: ViewIn): View {
  const out: View = { ...into };
  if (v.name !== undefined && v.name.trim()) out.name = v.name.trim();
  if (v.type !== undefined) {
    if (!(VIEW_TYPES as readonly string[]).includes(v.type)) throw new Error(`Unknown view type "${v.type}" — ${VIEW_TYPES.join(", ")}.`);
    out.type = v.type as ViewType;
  }
  if (v.groupBy !== undefined) out.groupBy = v.groupBy ? prop(schema, v.groupBy).id : undefined;
  if (v.dateProp !== undefined) out.dateProp = v.dateProp ? prop(schema, v.dateProp).id : undefined;
  if (v.endProp !== undefined) out.endProp = v.endProp ? prop(schema, v.endProp).id : undefined;
  if (v.chartKind !== undefined) out.chartKind = (["bar", "column", "line", "pie"] as const).find((k) => k === v.chartKind);
  if (v.chartCalc !== undefined) out.chartCalc = (["count", "sum", "avg"] as const).find((k) => k === v.chartCalc);
  if (v.chartProp !== undefined) out.chartProp = v.chartProp ? prop(schema, v.chartProp).id : undefined;
  if (v.hidden) out.hidden = ids(schema, v.hidden).filter((x) => x !== TITLE);
  if (v.order) out.order = columnOrder({ order: ids(schema, v.order) }, schema);
  if (v.sorts) out.sorts = v.sorts.map((s): Sort => ({ prop: lc(s.property) === "title" ? TITLE : prop(schema, s.property).id, dir: s.dir === "desc" ? "desc" : "asc" }));
  if (v.filter) out.filter = { op: "and", rules: v.filter.map((f) => ruleOf(schema, f)) } satisfies Filter;
  if (v.wrap !== undefined) out.wrap = v.wrap;
  // A board needs the property its columns are by, a calendar the date it is laid out by - the first fitting one when none is said.
  if (out.type === "board" && !out.groupBy) out.groupBy = schema.properties.find((p) => p.type === "status" || p.type === "select")?.id;
  if (out.type === "chart" && !out.groupBy) out.groupBy = schema.properties.find((p) => p.type === "status" || p.type === "select")?.id;
  if ((out.type === "calendar" || out.type === "timeline") && !out.dateProp) out.dateProp = schema.properties.find((p) => p.type === "date")?.id;
  return out;
}

/** The schema after the operations, in order; what couldn't be done throws (nothing is half done: the caller saves only a result). */
export function applyOps(schema: DbSchema, ops: DbOp[], ctx: OpsContext): { schema: DbSchema; notes: string[] } {
  let s: DbSchema = { ...schema, properties: [...schema.properties], views: [...schema.views] };
  const notes: string[] = [];
  for (const o of ops) {
    switch (o.op) {
      case "rename_title":
        s = { ...s, titleName: o.name.trim() || s.titleName };
        notes.push(`title column is now "${s.titleName}"`);
        break;
      case "add_property": {
        if (s.properties.some((x) => lc(x.name) === lc(o.name))) throw new Error(`There is a property "${o.name}" already.`);
        const made = fillProperty(s, newProperty(o.name, ((PROP_TYPES as readonly string[]).includes(o.type ?? "text") ? (o.type ?? "text") : "text") as PropType), { ...o, name: o.name }, ctx);
        const at = o.position !== undefined ? Math.max(0, Math.min(s.properties.length, o.position)) : s.properties.length;
        s = { ...s, properties: [...s.properties.slice(0, at), made, ...s.properties.slice(at)] };
        notes.push(`added ${made.type} property "${made.name}"`);
        break;
      }
      case "update_property": {
        const cur = prop(s, o.property);
        const next = fillProperty(s, cur, o, ctx);
        s = { ...s, properties: s.properties.map((x) => (x.id === cur.id ? next : x)) };
        notes.push(`changed property "${cur.name}"`);
        break;
      }
      case "remove_property": {
        const cur = prop(s, o.property);
        s = removeProperty(s, cur.id);
        notes.push(`removed property "${cur.name}" (its values are dropped when saved)`);
        break;
      }
      case "reorder_properties": {
        const want = o.names.map((n) => prop(s, n));
        const rest = s.properties.filter((x) => !want.includes(x));
        s = { ...s, properties: [...want, ...rest] };
        notes.push("reordered the properties");
        break;
      }
      case "add_view": {
        if (s.views.some((x) => lc(x.name) === lc(o.name))) throw new Error(`There is a view "${o.name}" already.`);
        const made = fillView(s, newView(o.name, (VIEW_TYPES as readonly string[]).includes(o.type ?? "table") ? ((o.type ?? "table") as ViewType) : "table"), { ...o, type: o.type ?? "table" });
        s = { ...s, views: [...s.views, made] };
        notes.push(`added ${made.type} view "${made.name}"`);
        break;
      }
      case "update_view": {
        const cur = viewOf(s, o.view);
        const next = fillView(s, cur, o);
        s = { ...s, views: s.views.map((x) => (x.id === cur.id ? next : x)) };
        notes.push(`changed view "${cur.name}"`);
        break;
      }
      case "remove_view": {
        const cur = viewOf(s, o.view);
        if (s.views.length < 2) throw new Error("A database keeps at least one view.");
        s = { ...s, views: s.views.filter((x) => x.id !== cur.id) };
        notes.push(`removed view "${cur.name}"`);
        break;
      }
      case "order_columns": {
        const cur = o.view ? viewOf(s, o.view) : s.views[0];
        const named = ids(s, o.order);
        // What is named comes first, in that order; the rest follows as it was.
        const all = columnOrder(cur, s);
        let order = all;
        for (const [i, id] of named.entries()) order = moveBefore(order, id, named[i - 1] ?? order[0], i > 0);
        s = { ...s, views: s.views.map((x) => (x.id === cur.id ? { ...x, order } : x)) };
        notes.push(`ordered the columns of "${cur.name}"`);
        break;
      }
    }
  }
  // An empty filter object is made for views that have none.
  s = { ...s, views: s.views.map((v) => ({ ...v, filter: v.filter ?? emptyFilter() })) };
  return { schema: s, notes };
}
