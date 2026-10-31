import { type Pipeline, type DataType, normalizePipeline, DATA_TYPES } from "./pipeline";
import { ids, newId } from "./util";

export const PROP_TYPES = ["text", "markdown", "number", "select", "multi_select", "status", "date", "checkbox", "url", "email", "phone", "person", "relation", "custom", "rollup", "formula", "created_time", "updated_time", "todo", "ticket", "ai", "button"] as const;
export type PropType = (typeof PROP_TYPES)[number];
export const PROP_LABELS: Record<PropType, string> = {
  text: "Text",
  markdown: "Markdown",
  number: "Number",
  select: "Select",
  multi_select: "Multi-select",
  status: "Status",
  date: "Date",
  checkbox: "Checkbox",
  url: "URL",
  email: "Email",
  phone: "Phone",
  person: "Person",
  relation: "Relation",
  rollup: "Rollup",
  formula: "Formula",
  custom: "Custom",
  created_time: "Created time",
  updated_time: "Last edited time",
  todo: "Zeff todo",
  ticket: "Jira ticket",
  ai: "AI",
  button: "Button",
};
export const COLORS = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"] as const;

export type Option = { id: string; name: string; color: string; /** Status options sit in a group (to do / doing / done). */ group?: "todo" | "doing" | "done" };
export const ROLLUP_FNS = ["count", "count_values", "count_unique", "count_empty", "count_not_empty", "percent_empty", "percent_not_empty", "sum", "average", "median", "min", "max", "range", "earliest", "latest", "show_original", "show_unique", "checked", "unchecked", "percent_checked", "percent_done"] as const;
export type RollupFn = (typeof ROLLUP_FNS)[number];
/** The calculations a table column offers under it (its sum row), over the rows the view shows — and what a published value is made of. */
export const CALC_FNS = ["sum", "average", "median", "min", "max", "count", "count_values"] as const satisfies readonly RollupFn[];
export type CalcFn = (typeof CALC_FNS)[number];

export type Property = {
  id: string;
  name: string;
  type: PropType;
  /** Button: the routine it runs with the row in hand (row-button.ts), and the button's text (else the property's name). Stores nothing. */
  button?: { routine: number; label?: string };
  /** A column of a daily list's log (day-log.ts): the item and field of the list it keeps ("<row id>:<property id>") — its name follows theirs. */
  dayKey?: string;
  options?: Option[];
  /** Relation: the database it points to; `backOf`: this is the other side of that property there (computed, not stored). */
  relationDb?: number;
  /** Relation: also show it on the related database (made when the schema is saved). */
  twoWay?: boolean;
  backOf?: string;
  /** Relation: linked by itself — the rows of the related database whose `to` value equals this row's `from` value (a property id, or "title"); computed, not stored. */
  match?: { from: string; to: string };
  /** Relation: instead of a database, a source of Zeff's own ("time": the booked time) — read where it lives, never stored; always with `match`. */
  relationSource?: string;
  /** `filter`: only the related rows that pass it count. */
  rollup?: { relation: string; property: string; fn: RollupFn; filter?: Filter };
  formula?: string;
  /** Custom: the id of the field type (a plugin's, "workspace.rating") that checks and draws the entries. */
  custom?: string;
  /** AI: the instruction the AI fills the cell by, from the row's other cells. */
  aiPrompt?: string;
  /** AI: the values it may take (one of them — "blocked", "active" …); none: free text. */
  aiChoices?: string[];
  /** AI: a colour (of the palette) per choice; the others take one by their place. */
  aiColors?: Record<string, string>;
  /** AI: instructions (pages under KI-Anweisungen) whose text goes with the prompt. */
  aiInstructions?: number[];
  format?: "number" | "percent" | "euro" | "dollar" | "hours" | "unit";
  /** Number, format "unit": what comes after the number ("mg", "ml", "km", "Stück"). */
  unit?: string;
  includeTime?: boolean;
  /** Date: a new row starts with today (when nothing else is given). */
  defaultToday?: boolean;
  /** Filled by itself (auto-fill.ts): when one of the fields `on` (ids) changes in a row, the formula's result goes in — still settable by hand. */
  auto?: { on: string[]; formula: string };
  /** Checkbox: when it is ticked, the time goes into a date field of its own (`stampOf` names this one, filled by itself) — a medicine taken at 8:30. */
  stampTime?: boolean;
  /** Date (with the time): the checkbox whose ticks it times. */
  stampOf?: string;
  /** Date: a deadline — its rows show in "Needs attention" so many days before it (and once it is past). */
  remind?: number;
};

export type Cond =
  | "contains" | "not_contains" | "is" | "is_not" | "starts_with" | "ends_with" | "is_empty" | "not_empty"
  | "eq" | "neq" | "gt" | "lt" | "gte" | "lte"
  | "before" | "after" | "on_or_before" | "on_or_after" | "past_week" | "past_month" | "next_week" | "next_month" | "this_week" | "today" | "this_month" | "last_month" | "this_year"
  | "checked" | "unchecked";
export type Rule = { prop: string; cond: Cond; value?: unknown };
export type Filter = { op: "and" | "or"; rules: (Rule | Filter)[] };
export type Sort = { prop: string; dir: "asc" | "desc" };
export const VIEW_TYPES = ["table", "board", "list", "gallery", "calendar", "timeline", "chart", "todo", "app"] as const;
export type ViewType = (typeof VIEW_TYPES)[number];
export type View = {
  id: string;
  name: string;
  type: ViewType;
  /** An app's view (type "app"): which (the mail client's "mail", the chat's "chat") — shown while its plugin is installed. */
  app?: string;
  /** An app's view: where its navigation (the entries of its sidebar) is — in the view (default), or in the Workspace tree under its database. */
  nav?: "workspace" | "off";
  /** The navigation's entries hidden (their ids) — in the tree they are only hidden and shown again, never deleted. */
  navHidden?: string[];
  filter: Filter;
  sorts: Sort[];
  /** Board: the columns; table/list: the groups. */
  groupBy?: string;
  hidden: string[];
  /** Calendar / timeline: the date property the rows sit on (a timeline: where a bar starts). */
  dateProp?: string;
  /** Timeline: the date property where a bar ends (none: the end of the start's own range, else one day). */
  endProp?: string;
  /** Chart: how the rows by `groupBy` are drawn (bars, columns, a line, a pie), what is counted - rows, or the sum / average of a number property. */
  chartKind?: "bar" | "column" | "line" | "pie";
  chartCalc?: "count" | "sum" | "avg";
  chartProp?: string;
  wrap?: boolean;
  widths?: Record<string, number>;
  /** Shows only your rows (the person filter's "Mine", kept with the view). */
  mine?: boolean;
  /** The order of the properties (ids); the rest follow. */
  order?: string[];
  /** Board: a column's WIP limit (by its option id) — more cards than that and its count turns red. */
  wip?: Record<string, number>;
  /** Board / gallery: how a card looks — a card template (card-template.ts); none: the automatic card. */
  card?: string;
  /** Table: the calculation under a column (its sum row), by property id. */
  calcs?: Record<string, CalcFn>;
  /** The database's hidden rows shown too (set back) — a switch in the view's menu. */
  showHidden?: boolean;
  /** Grouped by a field (table, list): the groups without rows left out — a switch in the view's menu. */
  hideEmpty?: boolean;
  /** An app's view (or a "template" view of any table): its own template (view-template.ts) — none: the app's default. */
  template?: string;
};
/** A table column's width in pixels: what a drag may make it, and what "fit to content" may. */
export const WIDTH_MIN = 60;
export const WIDTH_MAX = 1200;
export const FIT_MIN = 80;
export const FIT_MAX = 520;
export const DEFAULT_COLUMN = 224;

/** The view with these column widths (by property id, "title" for the title column), kept to the range; none: the table sizes itself again. */
export function withWidths(view: View, widths: Record<string, number> | null): View {
  const ok = Object.fromEntries(Object.entries(widths ?? {}).filter((e) => Number.isFinite(e[1])).map(([k, w]) => [k, Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, Math.round(w)))]));
  const { widths: _was, ...rest } = view;
  return Object.keys(ok).length ? { ...rest, widths: ok } : rest;
}

/** The width that fits a column: its widest content or its head (both measured with their padding), within a sensible range. */
export const fitWidth = (content: number, head: number): number => Math.min(FIT_MAX, Math.max(FIT_MIN, Math.ceil(Math.max(content, head)) + 2));

export type AgentsConfig = { auto?: true; parallel: number; perDay: number; defaultInstruction?: string };
export type DbSchema = {
  titleName: string;
  properties: Property[];
  views: View[];
  /** Shared for formulas: other tables' cells read it under this name (Kosten!B2, Kosten[Betrag]) — see sheet.ts. */
  share?: { name: string };
  /** The property that says whose a row is (person filter, "mine"); unset: the first person property, else a text "Assignee". */
  personProp?: string;
  /** What a row's detail view (the panel over the database) shows, in order; unset: what fits the database (detailModules). */
  detail?: DetailModule[];
  /** The AI review: its AI properties filled by a run of their own (scheduled, the changed rows only) — see review.ts. */
  review?: { on: boolean; skipBriefed?: boolean; openOnly?: boolean; recentDays?: number };
  /** Where its rows come from and what's done with them, as steps (blocks) — kept in the database by a run (pipeline.ts). */
  pipeline?: Pipeline;
  /** What its rows are (mails, messages — set by its sources): their fixed fields are there for the views that need them. */
  dataType?: DataType;
  /** The database receives rows sent from others (links.ts): they land in this column (`value`: its option's id) of this select / status property. */
  receive?: { prop: string; value: string };
  /** A jobs database's agents: Ready cards taken by themselves (`auto`), at most `parallel` at a time and `perDay` a day; `defaultInstruction` for a job without words of its own. */
  agents?: AgentsConfig;
  /** A database of rules (when / then): a pipeline's rules step reads it, agents read its hints. */
  rules?: boolean;
  /** A database of jobs for agents: a row is a job a worker can be given (a click), its result comes back into the row. */
  jobs?: boolean;
  /** A daily list (day-log.ts): a log of each day, unticked at 4:00, "Close the day". Unset: on when a checkbox records the time. */
  dayList?: boolean;
  /** Its entry form: a form page whose answers make its rows — "New" opens it (a dialog) instead of an empty row. Unset: an empty row. */
  entryForm?: number;
  /** A todo list: which checkbox says done and which date says due (ids), and whether its open rows are todos of the Todo engine too (todo-engine.ts). */
  todoList?: TodoListSpec;
  /** What may be done to its rows (the store holds to it, for you and the AI alike; a source writing its own records is let through). */
  protect?: Protect;
  /** Rows hidden from its views (their ids) — the rows themselves untouched (a synced one too); a view can show them again. */
  hiddenRows?: number[];
  /** Its rows' own page (a person's, a case's) as a view template of yours — none: the plugin's. */
  rowTemplate?: string;
};

/** The schema with these rows hidden (`hide`) or shown again — each id once; none left: no key. */
export function hideRows(schema: DbSchema, ids: number[], hide: boolean): DbSchema {
  const now = new Set(schema.hiddenRows ?? []);
  for (const id of ids) {
    if (hide) now.add(id);
    else now.delete(id);
  }
  const { hiddenRows: _was, ...rest } = schema;
  return now.size ? { ...rest, hiddenRows: [...now] } : rest;
}

/** The rows a view shows: the hidden ones left out — unless it shows them too. */
export function shownRows<R extends { id: number }>(rows: R[], schema: Pick<DbSchema, "hiddenRows">, view: Pick<View, "showHidden">): R[] {
  if (view.showHidden || !schema.hiddenRows?.length) return rows;
  const hidden = new Set(schema.hiddenRows);
  return rows.filter((r) => !hidden.has(r.id));
}

export type TodoListSpec = { done: string; due?: string; engine?: boolean };

/** The checkbox and date a todo list goes by - what it says, else its first checkbox and date (null: no checkbox, so no todo list). */
export function todoColumns(schema: Pick<DbSchema, "properties" | "todoList">): { done: Property; due?: Property; engine: boolean } | null {
  const spec = schema.todoList;
  const done = schema.properties.find((p) => p.id === spec?.done && p.type === "checkbox") ?? schema.properties.find((p) => p.type === "checkbox" && !p.id.startsWith("src"));
  if (!done) return null;
  const due = schema.properties.find((p) => p.id === spec?.due && p.type === "date") ?? (spec ? undefined : schema.properties.find((p) => p.type === "date"));
  return { done, due, engine: !!spec?.engine };
}

function todoListOf(raw: unknown, props: Property[]): TodoListSpec | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const done = props.find((p) => p.id === o.done && p.type === "checkbox");
  if (!done) return undefined;
  const due = props.find((p) => p.id === o.due && p.type === "date");
  return { done: done.id, ...(due ? { due: due.id } : {}), ...(o.engine === true ? { engine: true } : {}) };
}

/**
 * `lock`: its rows can't be added, changed or removed. `ai`: what the AI may do - "read" (nothing) or "append" (add rows, not change or remove
 * them); unset: everything. `unique`: fields (their ids, "title" for the title) whose values may not repeat among the rows.
 */
export type Protect = { lock?: boolean; ai?: "read" | "append"; unique?: string[] };

function protectOf(raw: unknown, props: Property[]): Protect | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const unique = (Array.isArray(o.unique) ? o.unique : []).filter((id): id is string => typeof id === "string" && (id === "title" || props.some((p) => p.id === id && !isComputed(p))));
  const out: Protect = { ...(o.lock === true ? { lock: true } : {}), ...(o.ai === "read" || o.ai === "append" ? { ai: o.ai } : {}), ...(unique.length ? { unique: [...new Set(unique)] } : {}) };
  return Object.keys(out).length ? out : undefined;
}

/** The modules a row's detail view can show: its properties and page, and — by its ticket key — what Zeff knows about it. */
export const DETAIL_MODULES = ["properties", "source", "subtasks", "suggested", "briefing", "todos", "questions", "actions", "flags", "context", "chat", "page", "timeline", "know"] as const;
export type DetailModule = (typeof DETAIL_MODULES)[number];
const isDetailModule = (v: unknown): v is DetailModule => (DETAIL_MODULES as readonly unknown[]).includes(v);

/** A row as the views get it: the page, and its cells by property id (stored values, and the computed ones filled in). */
export type Row = { id: number; title: string; icon: string; cells: Record<string, unknown>; createdAt: string; updatedAt: string };

/** What a page of the Workspace is: a document, a database (its rows are pages too), or a form that makes rows of a database (forms.ts). */
export const PAGE_KINDS = ["page", "database", "form"] as const;
export type PageKind = (typeof PAGE_KINDS)[number];
/** A kind as stored (any text) made one of the kinds — what isn't known is a page. */
export const pageKind = (v: unknown): PageKind => ((PAGE_KINDS as readonly unknown[]).includes(v) ? (v as PageKind) : "page");
/** The sign of a page without an icon of its own, by its kind. */
export const kindIcon = (kind: string): string => (kind === "database" ? "🗂️" : kind === "form" ? "📝" : "📄");

/** The pseudo-properties every database has. */
export const TITLE = "title";
/** The property a ticket row keeps its key in (collections.ts: KEY_PROP). */
export const TICKET_KEY = "ticketkey";
export const CREATED = "created_at";
export const UPDATED = "updated_at";

/**
 * The columns of a table in the order a view shows them: the title and the properties (ids), by `view.order`
 * (which may name the title anywhere - a column can sit before it); what the order doesn't name follows in its
 * natural place (the title first, then the properties as the schema has them).
 */
export function columnOrder(view: Pick<View, "order">, schema: Pick<DbSchema, "properties">): string[] {
  const natural = [TITLE, ...schema.properties.map((p) => p.id)];
  const order = (view.order ?? []).filter((id) => natural.includes(id));
  return [...order, ...natural.filter((id) => !order.includes(id))];
}

/** `ids` with `from` moved next to `to` (before it, or after). */
export function moveBefore(ids: string[], from: string, to: string, after = false): string[] {
  if (from === to || !ids.includes(from) || !ids.includes(to)) return ids;
  const rest = ids.filter((x) => x !== from);
  const at = rest.indexOf(to) + (after ? 1 : 0);
  return [...rest.slice(0, at), from, ...rest.slice(at)];
}

/** Whether other properties hang on this one (a rollup through it, the other side of a relation). */
export const hasDependents = (schema: Pick<DbSchema, "properties">, id: string): boolean => schema.properties.some((x) => x.id !== id && ((x.type === "rollup" && x.rollup?.relation === id) || (x.type === "relation" && x.backOf === id)));

/** The schema without a property: the rollups through it go too, and every view forgets it (hidden, order, grouping, dates, sorts). */
export function removeProperty(schema: DbSchema, id: string): DbSchema {
  return {
    ...schema,
    properties: schema.properties.filter((x) => x.id !== id && !(x.type === "rollup" && x.rollup?.relation === id)),
    views: schema.views.map((v) => ({ ...v, hidden: v.hidden.filter((h) => h !== id), order: v.order?.filter((x) => x !== id), groupBy: v.groupBy === id ? undefined : v.groupBy, dateProp: v.dateProp === id ? undefined : v.dateProp, sorts: v.sorts.filter((s) => s.prop !== id) })),
  };
}
export const emptyFilter = (): Filter => ({ op: "and", rules: [] });
export const isFilter = (r: Rule | Filter): r is Filter => "rules" in r;

export const isComputed = (p: Property): boolean => p.type === "button" || p.type === "rollup" || p.type === "formula" || p.type === "created_time" || p.type === "updated_time" || (p.type === "relation" && (!!p.backOf || !!p.match));

export function defaultOptions(type: PropType): Option[] | undefined {
  if (type === "status")
    return [
      { id: newId("o"), name: "Not started", color: "gray", group: "todo" },
      { id: newId("o"), name: "In progress", color: "blue", group: "doing" },
      { id: newId("o"), name: "Done", color: "green", group: "done" },
    ];
  if (type === "select" || type === "multi_select") return [];
  return undefined;
}

/** A column turned into another type: its id, name and settings stay; a type with choices starts with some when it has none. */
export function retype(p: Property, type: PropType): Property {
  const next: Property = { ...p, type };
  if (type !== "custom") delete next.custom;
  if (!next.options?.length) {
    const options = defaultOptions(type);
    if (options) next.options = options;
  }
  return next;
}

export function newProperty(name: string, type: PropType): Property {
  const p: Property = { id: newId("p"), name, type };
  const o = defaultOptions(type);
  if (o) p.options = o;
  return p;
}

export function newView(name: string, type: ViewType = "table"): View {
  return { id: newId("v"), name, type, filter: emptyFilter(), sorts: [], hidden: [] };
}

/** A new database's schema: a title, a status and a date, one table view. */
export function defaultSchema(): DbSchema {
  return { titleName: "Name", properties: [newProperty("Status", "status"), newProperty("Date", "date")], views: [newView("Table", "table")] };
}

/** A database's AI review settings, as stored (what's not known left out). */
const normalizeReview = (r: Record<string, unknown>): NonNullable<DbSchema["review"]> => ({
  on: !!r.on,
  ...(r.skipBriefed ? { skipBriefed: true } : {}),
  ...(r.openOnly ? { openOnly: true } : {}),
  ...(Number(r.recentDays) > 0 ? { recentDays: Math.floor(Number(r.recentDays)) } : {}),
});

/** A schema from stored JSON, repaired: every view and property has what the code relies on. */
/** The agents setting as it is kept: sane limits (1–8 workers, 1–200 a day), off unless switched on. */
function agentsOf(raw: unknown): AgentsConfig | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const n = (v: unknown, lo: number, hi: number, d: number) => (Number.isFinite(Number(v)) && Number(v) >= 1 ? Math.min(hi, Math.max(lo, Math.floor(Number(v)))) : d);
  const text = typeof r.defaultInstruction === "string" ? r.defaultInstruction.trim().slice(0, 2000) : "";
  return { ...(r.auto === true ? { auto: true as const } : {}), parallel: n(r.parallel, 1, 8, 1), perDay: n(r.perDay, 1, 200, 20), ...(text ? { defaultInstruction: text } : {}) };
}

/** The receiving setting as it is kept: only for a select / status property that has the landing column. */
function receiveOf(raw: unknown, props: Property[]): { prop: string; value: string } | undefined {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const p = props.find((x) => x.id === r.prop);
  return p && (p.type === "status" || p.type === "select") && p.options?.some((o) => o.id === r.value) ? { prop: p.id, value: String(r.value) } : undefined;
}

/** An AI property's colours kept to the palette (and to colours given at all). */
function withAiColors(p: Property): Property {
  if (!p.aiColors) return p;
  const ok = Object.fromEntries(Object.entries(p.aiColors).filter((e) => (COLORS as readonly string[]).includes(e[1])));
  const { aiColors: _was, ...rest } = p;
  return Object.keys(ok).length ? { ...rest, aiColors: ok } : rest;
}

/** The colour of one of an AI property's choices: the one set, else one of the palette by its place (grey when it isn't a choice). */
export function choiceColor(p: Property, name: string): string {
  const i = p.aiChoices?.indexOf(name) ?? -1;
  if (i < 0) return "gray";
  return p.aiColors?.[name] ?? COLORS[(i + 1) % COLORS.length];
}

/** Hidden rows as kept: row ids, each once (none: undefined). */
const hiddenRowsOf = (v: unknown): number[] | undefined => {
  const ids = Array.isArray(v) ? [...new Set(v.filter((x): x is number => Number.isInteger(x) && x > 0))] : [];
  return ids.length ? ids : undefined;
};

export function normalizeSchema(raw: unknown): DbSchema {
  const o = (raw && typeof raw === "object" ? raw : {}) as Partial<DbSchema>;
  const props = (Array.isArray(o.properties) ? o.properties : []).filter((p): p is Property => !!p && typeof p.id === "string" && (PROP_TYPES as readonly string[]).includes(p.type)).map(withAiColors);
  const views = (Array.isArray(o.views) ? o.views : []).filter((v): v is View => !!v && typeof v.id === "string" && (VIEW_TYPES as readonly string[]).includes(v.type)).map((v) => ({ ...v, name: v.name || "View", filter: v.filter && isFilter(v.filter) ? v.filter : emptyFilter(), sorts: Array.isArray(v.sorts) ? v.sorts : [], hidden: Array.isArray(v.hidden) ? v.hidden : [], card: typeof v.card === "string" && v.card.trim() ? v.card.slice(0, 8000) : undefined, nav: (v.nav === "workspace" || v.nav === "off") && v.app ? v.nav : undefined, navHidden: Array.isArray(v.navHidden) && v.navHidden.length ? v.navHidden.filter((x): x is string => typeof x === "string").slice(0, 100) : undefined }));
  return { titleName: typeof o.titleName === "string" && o.titleName ? o.titleName : "Name", properties: props, views: views.length ? views : [newView("Table")], ...(typeof o.personProp === "string" && props.some((p) => p.id === o.personProp) ? { personProp: o.personProp } : {}), ...(Array.isArray(o.detail) ? { detail: [...new Set(o.detail.filter(isDetailModule))] } : {}), ...(o.review && typeof o.review === "object" ? { review: normalizeReview(o.review as Record<string, unknown>) } : {}), ...(o.pipeline && typeof o.pipeline === "object" ? { pipeline: normalizePipeline(o.pipeline) } : {}), ...((DATA_TYPES as readonly unknown[]).includes(o.dataType) ? { dataType: o.dataType } : {}), ...(receiveOf(o.receive, props) ? { receive: receiveOf(o.receive, props) } : {}), ...(Number.isInteger(o.entryForm) && o.entryForm! > 0 ? { entryForm: o.entryForm } : {}), ...(protectOf(o.protect, props) ? { protect: protectOf(o.protect, props) } : {}), ...(todoListOf(o.todoList, props) ? { todoList: todoListOf(o.todoList, props) } : {}), ...(o.rules === true ? { rules: true } : {}), ...(hiddenRowsOf(o.hiddenRows) ? { hiddenRows: hiddenRowsOf(o.hiddenRows) } : {}), ...(typeof o.rowTemplate === "string" && o.rowTemplate.trim() ? { rowTemplate: o.rowTemplate.slice(0, 20000) } : {}), ...(o.jobs === true ? { jobs: true } : {}), ...(typeof o.dayList === "boolean" ? { dayList: o.dayList } : {}), ...(agentsOf(o.agents) ? { agents: agentsOf(o.agents) } : {}), ...(shareOf(o.share) ? { share: shareOf(o.share)! } : {}) };
}

export const propById = (props: Property[], id: string): Property | undefined => props.find((p) => p.id === id);

/** A list ticked through every day (day-log.ts): switched on in its settings — unset, a checkbox recording the time makes it one. */
export const isDayList = (schema: Pick<DbSchema, "properties" | "dayList">): boolean => schema.dayList ?? schema.properties.some((p) => p.type === "checkbox" && p.stampTime);

/** What Zeff keeps on a row for itself (a moved card's ticket key, a moved note's ref): not shown among its properties. */
export const SYSTEM_PROPS = new Set(["ticketkey", "noteref", "srcref", "srcedited"]);
/** The properties a row's panel shows. */
export const panelProperties = (props: Property[]): Property[] => props.filter((p) => !SYSTEM_PROPS.has(p.id));

/** A name a table is shared under for formulas: letters, digits, spaces, _ and - (60 at most) — anything else: not shared. */
export function shareOf(v: unknown): { name: string } | null {
  const name = v && typeof v === "object" && typeof (v as { name?: unknown }).name === "string" ? (v as { name: string }).name.replace(/\s+/g, " ").trim().slice(0, 60) : "";
  return name && /^[\p{L}\p{N}_ -]+$/u.test(name) ? { name } : null;
}
