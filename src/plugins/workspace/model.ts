/**
 * Databases (the Workspace plugin): what a database is made of — typed properties, views with
 * filters, sorts and groups — and the logic over its rows that both the server and the views need:
 * matching, sorting, grouping, and the computed properties (formulas, rollups through relations, back
 * relations, created/edited times). Pure functions over plain data; client-safe.
 */
import { evalFormula, formulaToStored, type FormulaValue } from "./formula";

export const PROP_TYPES = ["text", "markdown", "number", "select", "multi_select", "status", "date", "checkbox", "url", "email", "phone", "person", "relation", "rollup", "formula", "created_time", "updated_time", "todo", "ticket", "ai"] as const;
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
  created_time: "Created time",
  updated_time: "Last edited time",
  todo: "Zeff todo",
  ticket: "Jira ticket",
  ai: "AI",
};
export const COLORS = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"] as const;

export type Option = { id: string; name: string; color: string; /** Status options sit in a group (to do / doing / done). */ group?: "todo" | "doing" | "done" };
export const ROLLUP_FNS = ["count", "count_values", "count_unique", "count_empty", "count_not_empty", "percent_empty", "percent_not_empty", "sum", "average", "median", "min", "max", "range", "earliest", "latest", "show_original", "show_unique", "checked", "unchecked", "percent_checked", "percent_done"] as const;
export type RollupFn = (typeof ROLLUP_FNS)[number];

export type Property = {
  id: string;
  name: string;
  type: PropType;
  options?: Option[];
  /** Relation: the database it points to; `backOf`: this is the other side of that property there (computed, not stored). */
  relationDb?: number;
  /** Relation: also show it on the related database (made when the schema is saved). */
  twoWay?: boolean;
  backOf?: string;
  rollup?: { relation: string; property: string; fn: RollupFn };
  formula?: string;
  /** AI: the instruction the AI fills the cell by, from the row's other cells. */
  aiPrompt?: string;
  /** AI: the values it may take (one of them — "blocked", "active" …); none: free text. */
  aiChoices?: string[];
  /** AI: a colour (of the palette) per choice; the others take one by their place. */
  aiColors?: Record<string, string>;
  /** AI: instructions (pages under KI-Anweisungen) whose text goes with the prompt. */
  aiInstructions?: number[];
  format?: "number" | "percent" | "euro" | "dollar" | "hours";
  includeTime?: boolean;
};

export type Cond =
  | "contains" | "not_contains" | "is" | "is_not" | "starts_with" | "ends_with" | "is_empty" | "not_empty"
  | "eq" | "neq" | "gt" | "lt" | "gte" | "lte"
  | "before" | "after" | "on_or_before" | "on_or_after" | "past_week" | "past_month" | "next_week" | "next_month" | "this_week" | "today"
  | "checked" | "unchecked";
export type Rule = { prop: string; cond: Cond; value?: unknown };
export type Filter = { op: "and" | "or"; rules: (Rule | Filter)[] };
export type Sort = { prop: string; dir: "asc" | "desc" };
export const VIEW_TYPES = ["table", "board", "list", "gallery", "calendar", "app"] as const;
export type ViewType = (typeof VIEW_TYPES)[number];
export type View = {
  id: string;
  name: string;
  type: ViewType;
  /** An app's view (type "app"): which (the mail client's "mail", the chat's "chat") — shown while its plugin is installed. */
  app?: string;
  filter: Filter;
  sorts: Sort[];
  /** Board: the columns; table/list: the groups. */
  groupBy?: string;
  hidden: string[];
  /** Calendar: the date property the rows sit on. */
  dateProp?: string;
  wrap?: boolean;
  widths?: Record<string, number>;
  /** Shows only your rows (the person filter's "Mine", kept with the view). */
  mine?: boolean;
  /** The order of the properties (ids); the rest follow. */
  order?: string[];
  /** Board: a column's WIP limit (by its option id) — more cards than that and its count turns red. */
  wip?: Record<string, number>;
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

export type DbSchema = {
  titleName: string;
  properties: Property[];
  views: View[];
  /** The property that says whose a row is (person filter, "mine"); unset: the first person property, else a text "Assignee". */
  personProp?: string;
  /** What a row's detail view (the panel over the database) shows, in order; unset: what fits the database (detailModules). */
  detail?: DetailModule[];
  /** Its detail view as a page of blocks (System → Detail views): what a row's panel shows, laid out as you like. */
  detailPage?: number;
  /** The AI review: its AI properties filled by a run of their own (scheduled, the changed rows only) — see review.ts. */
  review?: { on: boolean; skipBriefed?: boolean; openOnly?: boolean; recentDays?: number };
  /** Where its rows come from and what's done with them, as steps (blocks) — kept in the database by a run (pipeline.ts). */
  pipeline?: Pipeline;
  /** What its rows are (mails, messages — set by its sources): their fixed fields are there for the views that need them. */
  dataType?: DataType;
};

/** The sources a pipeline can read: Jira's tickets, Google Keep's notes, the todos, another database of the Workspace, the addresses of the knowledge base. */
export const PIPELINE_SOURCES = ["jira", "keep", "todos", "database", "mail", "messages", "knowledge"] as const;
/** What a database's rows can be, by their sources: mails (Outlook, Gmail), messages (Teams, WhatsApp, Signal). */
export const DATA_TYPES = ["mail", "message", "inbox"] as const;
export type DataType = (typeof DATA_TYPES)[number];
export const MAIL_ACCOUNTS = ["outlook", "gmail"] as const;
export const MESSAGE_CHANNELS = ["teams", "whatsapp", "signal"] as const;
/** Which mails: of these accounts (none: all), in these folders, unread only, received within days. */
export type MailCriteria = { accounts?: (typeof MAIL_ACCOUNTS)[number][]; folders?: string[]; unreadOnly?: boolean; recentDays?: number };
/** Which messages: of these channels (none: all), chats named like this, sent within days. */
export type MessageCriteria = { channels?: (typeof MESSAGE_CHANNELS)[number][]; chat?: string; recentDays?: number };
/** Which addresses: those the knowledge base holds for these search terms (a project, a system); not the ones the database `excludeDb` (or this one, by hand) has already. */
export type KnowledgeCriteria = { terms: string[]; excludeDb?: number };
export type PipelineSource = (typeof PIPELINE_SOURCES)[number];
/**
 * Which Jira tickets: on you, or followed, or in the Ticket-Lage (either; none set: any); moved / commented within days;
 * open (and done within doneDays still); of these projects.
 */
export type JiraCriteria = { mine?: boolean; involved?: boolean; briefed?: boolean; recentDays?: number; commented?: boolean; openOnly?: boolean; doneDays?: number; projects?: string[] };

/**
 * A step of a pipeline. source: rows from `from` (jira by `jira`, keep by `label`, todos by `todoStatus`, a database by
 * `dbId`). filter: only the rows with `text`, open (`openOnly`), changed within `recentDays`, the first `limit`. ai: a field
 * on each row (`output` field: `name`, `prompt`, `choices` — kept as the AI property `prop`), or one text over all of them
 * (`output` summary: `prompt`, its last `result`).
 */
export type PipelineStep = {
  id: string;
  kind: "source" | "filter" | "ai" | "sort" | "write" | "set" | "join";
  from?: PipelineSource;
  jira?: JiraCriteria;
  mail?: MailCriteria;
  messages?: MessageCriteria;
  knowledge?: KnowledgeCriteria;
  label?: string;
  todoStatus?: "open" | "all";
  dbId?: number;
  text?: string;
  openOnly?: boolean;
  recentDays?: number;
  limit?: number;
  output?: "field" | "summary" | "filter" | "actions";
  /** Filter: rules as Outlook's (a field by its name, a condition, a value) — all of them, or any. */
  rules?: FilterRule[];
  match?: "all" | "any";
  /** Write: the database the rows that come out are put into (title, the fields of the same name, the text once). */
  to?: number;
  /** Sort: the field (its name) the rows go by, and which way. Join: the field of the other database a name is matched with (default: its title). */
  by?: string;
  dir?: "asc" | "desc";
  prop?: string;
  /** Set: the value the field (`name`) gets on the rows its rules match. */
  setValue?: string;
  /** Join: the field here (its name) that names a row of the database `dbId`, the field there it is matched with (default: its title), and the fields there brought along. */
  on?: string;
  bring?: string[];
  name?: string;
  prompt?: string;
  choices?: string[];
  /** AI steps: the instructions (pages under KI-Anweisungen) that go with the prompt. */
  instructions?: number[];
  result?: { text: string; at: string; hash?: string };
};
/** A pipeline: its steps; when it last ran; and how it runs by itself — its AI after every sync of its sources, and/or every N minutes. */
export type Pipeline = { steps: PipelineStep[]; ranAt?: string; autoAi?: boolean; everyMinutes?: number; /** A checkbox property (its id): a row ticked in it is final — a run neither changes nor archives it, and the AI leaves it. */ keepProp?: string };

/** A filter's conditions: contains, doesn't contain, is, isn't (a checkbox: yes / no), empty, not empty. */
export const FILTER_OPS = ["contains", "not_contains", "is", "is_not", "empty", "not_empty"] as const;
export type FilterRule = { field: string; op: (typeof FILTER_OPS)[number]; value?: string };

const posInt = (v: unknown): number | undefined => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : undefined;
};
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const strs = (v: unknown): string[] | undefined => {
  const out = Array.isArray(v) ? v.map(str).filter((x): x is string => !!x) : [];
  return out.length ? out : undefined;
};
const ids = (v: unknown): number[] | undefined => {
  const out = [...new Set((Array.isArray(v) ? v : []).map(posInt).filter((x): x is number => !!x))];
  return out.length ? out : undefined;
};
/** Only what's set (no undefined keys: a step compares as it's stored). */
const defined = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== false)) as T;

/** A pipeline as stored: its steps kept to what they can be (unknown ones dropped, each with an id). */
export function normalizePipeline(raw: unknown): Pipeline {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const steps: PipelineStep[] = [];
  for (const x of Array.isArray(o.steps) ? o.steps : []) {
    if (!x || typeof x !== "object") continue;
    const s = x as Record<string, unknown>;
    const id = str(s.id) ?? newId("s");
    if (s.kind === "source") {
      if (!(PIPELINE_SOURCES as readonly unknown[]).includes(s.from)) continue;
      const from = s.from as PipelineSource;
      const j = (s.jira && typeof s.jira === "object" ? s.jira : {}) as Record<string, unknown>;
      const jira = from === "jira" ? defined<JiraCriteria>({ mine: j.mine === true, involved: j.involved === true, briefed: j.briefed === true, recentDays: posInt(j.recentDays), commented: j.commented === true, openOnly: j.openOnly === true, doneDays: posInt(j.doneDays), projects: strs(j.projects) }) : undefined;
      const ml = (s.mail && typeof s.mail === "object" ? s.mail : {}) as Record<string, unknown>;
      const mg = (s.messages && typeof s.messages === "object" ? s.messages : {}) as Record<string, unknown>;
      const mail = from === "mail" ? defined<MailCriteria>({ accounts: strs(ml.accounts)?.filter((a): a is MailCriteria["accounts"] & string => (MAIL_ACCOUNTS as readonly string[]).includes(a)) as MailCriteria["accounts"], folders: strs(ml.folders), unreadOnly: ml.unreadOnly === true, recentDays: posInt(ml.recentDays) }) : undefined;
      const messages = from === "messages" ? defined<MessageCriteria>({ channels: strs(mg.channels)?.filter((c) => (MESSAGE_CHANNELS as readonly string[]).includes(c)) as MessageCriteria["channels"], chat: str(mg.chat), recentDays: posInt(mg.recentDays) }) : undefined;
      const kn = (s.knowledge && typeof s.knowledge === "object" ? s.knowledge : {}) as Record<string, unknown>;
      const terms = strs(kn.terms);
      const knowledge = from === "knowledge" && terms ? defined<KnowledgeCriteria>({ terms, excludeDb: posInt(kn.excludeDb) }) : undefined;
      steps.push(defined<PipelineStep>({ id, kind: "source", from, jira, mail, messages, knowledge, label: from === "keep" ? str(s.label) : undefined, todoStatus: from === "todos" && s.todoStatus === "all" ? "all" : undefined, dbId: from === "database" ? posInt(s.dbId) : undefined }));
    } else if (s.kind === "filter") {
      const rules = (Array.isArray(s.rules) ? s.rules : []).flatMap((x): FilterRule[] => {
        const r = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
        const field = str(r.field);
        if (!field || !(FILTER_OPS as readonly unknown[]).includes(r.op)) return [];
        return [defined<FilterRule>({ field, op: r.op as FilterRule["op"], value: typeof r.value === "string" ? r.value : undefined })];
      });
      steps.push(defined<PipelineStep>({ id, kind: "filter", text: str(s.text), openOnly: s.openOnly === true, recentDays: posInt(s.recentDays), limit: posInt(s.limit), rules: rules.length ? rules : undefined, match: rules.length && s.match === "any" ? "any" : undefined }));
    } else if (s.kind === "write") {
      if (posInt(s.to)) steps.push(defined<PipelineStep>({ id, kind: "write", to: posInt(s.to) }));
    } else if (s.kind === "join") {
      if (posInt(s.dbId) && str(s.on)) steps.push(defined<PipelineStep>({ id, kind: "join", dbId: posInt(s.dbId), on: str(s.on), by: str(s.by), bring: strs(s.bring) }));
    } else if (s.kind === "set") {
      const rules = (Array.isArray(s.rules) ? s.rules : []).flatMap((x): FilterRule[] => {
        const r = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
        const field = str(r.field);
        if (!field || !(FILTER_OPS as readonly unknown[]).includes(r.op)) return [];
        return [defined<FilterRule>({ field, op: r.op as FilterRule["op"], value: typeof r.value === "string" ? r.value : undefined })];
      });
      if (str(s.name)) steps.push(defined<PipelineStep>({ id, kind: "set", name: str(s.name), setValue: typeof s.setValue === "string" ? s.setValue.trim() : "", rules: rules.length ? rules : undefined, match: rules.length && s.match === "any" ? "any" : undefined }));
    } else if (s.kind === "sort") {
      if (str(s.by)) steps.push(defined<PipelineStep>({ id, kind: "sort", by: str(s.by), dir: s.dir === "desc" ? "desc" : undefined }));
    } else if (s.kind === "ai" && (s.output === "field" || s.output === "summary" || s.output === "filter" || s.output === "actions")) {
      const r = s.result as { text?: unknown; at?: unknown; hash?: unknown } | undefined;
      const result = r && typeof r.text === "string" && typeof r.at === "string" ? { text: r.text, at: r.at, ...(typeof r.hash === "string" ? { hash: r.hash } : {}) } : undefined;
      steps.push(defined<PipelineStep>({ id, kind: "ai", output: s.output, prop: s.output === "field" ? str(s.prop) : undefined, name: s.output === "field" ? (str(s.name) ?? "AI") : undefined, prompt: str(s.prompt), choices: s.output === "field" ? strs(s.choices) : undefined, instructions: ids(s.instructions), result: s.output === "summary" ? result : undefined }));
    }
  }
  return { steps, ...(typeof o.ranAt === "string" ? { ranAt: o.ranAt } : {}), ...(o.autoAi === true ? { autoAi: true } : {}), ...(posInt(o.everyMinutes) ? { everyMinutes: Math.min(10080, posInt(o.everyMinutes)!) } : {}), ...(str(o.keepProp) ? { keepProp: str(o.keepProp) } : {}) };
}

/** The modules a row's detail view can show: its properties and page, and — by its ticket key — what Zeff knows about it. */
export const DETAIL_MODULES = ["properties", "subtasks", "suggested", "briefing", "todos", "questions", "actions", "flags", "context", "chat", "page"] as const;
export type DetailModule = (typeof DETAIL_MODULES)[number];
const isDetailModule = (v: unknown): v is DetailModule => (DETAIL_MODULES as readonly unknown[]).includes(v);

/** A row as the views get it: the page, and its cells by property id (stored values, and the computed ones filled in). */
export type Row = { id: number; title: string; icon: string; cells: Record<string, unknown>; createdAt: string; updatedAt: string };

/** The pseudo-properties every database has. */
export const TITLE = "title";
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

export const newId = (prefix = "x"): string => `${prefix}${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;
export const emptyFilter = (): Filter => ({ op: "and", rules: [] });
export const isFilter = (r: Rule | Filter): r is Filter => "rules" in r;

export const isComputed = (p: Property): boolean => p.type === "rollup" || p.type === "formula" || p.type === "created_time" || p.type === "updated_time" || (p.type === "relation" && !!p.backOf);

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

export function normalizeSchema(raw: unknown): DbSchema {
  const o = (raw && typeof raw === "object" ? raw : {}) as Partial<DbSchema>;
  const props = (Array.isArray(o.properties) ? o.properties : []).filter((p): p is Property => !!p && typeof p.id === "string" && (PROP_TYPES as readonly string[]).includes(p.type)).map(withAiColors);
  const views = (Array.isArray(o.views) ? o.views : []).filter((v): v is View => !!v && typeof v.id === "string" && (VIEW_TYPES as readonly string[]).includes(v.type)).map((v) => ({ ...v, name: v.name || "View", filter: v.filter && isFilter(v.filter) ? v.filter : emptyFilter(), sorts: Array.isArray(v.sorts) ? v.sorts : [], hidden: Array.isArray(v.hidden) ? v.hidden : [] }));
  return { titleName: typeof o.titleName === "string" && o.titleName ? o.titleName : "Name", properties: props, views: views.length ? views : [newView("Table")], ...(typeof o.personProp === "string" && props.some((p) => p.id === o.personProp) ? { personProp: o.personProp } : {}), ...(Array.isArray(o.detail) ? { detail: [...new Set(o.detail.filter(isDetailModule))] } : {}), ...(Number.isInteger(o.detailPage) && Number(o.detailPage) > 0 ? { detailPage: Number(o.detailPage) } : {}), ...(o.review && typeof o.review === "object" ? { review: normalizeReview(o.review as Record<string, unknown>) } : {}), ...(o.pipeline && typeof o.pipeline === "object" ? { pipeline: normalizePipeline(o.pipeline) } : {}), ...((DATA_TYPES as readonly unknown[]).includes(o.dataType) ? { dataType: o.dataType } : {}) };
}

export const propById = (props: Property[], id: string): Property | undefined => props.find((p) => p.id === id);

/** What Zeff keeps on a row for itself (a moved card's ticket key, a moved note's ref): not shown among its properties. */
export const SYSTEM_PROPS = new Set(["ticketkey", "noteref", "srcref", "srcedited"]);
/** The properties a row's panel shows. */
export const panelProperties = (props: Property[]): Property[] => props.filter((p) => !SYSTEM_PROPS.has(p.id));

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

/** A date value as {start, end?}: a text "2026-10-14" / "2026-10-14T09:00", or {start, end}. */
export function dateRange(v: unknown): { start: string; end?: string } | null {
  if (typeof v === "string" && v) return { start: v };
  if (v && typeof v === "object" && typeof (v as { start?: unknown }).start === "string" && (v as { start: string }).start) {
    const o = v as { start: string; end?: unknown };
    return { start: o.start, end: typeof o.end === "string" && o.end ? o.end : undefined };
  }
  return null;
}

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === null || v === undefined || v === "" ? [] : [v]);

export function isEmptyValue(p: Property | undefined, v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (p?.type === "checkbox") return false;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  if (p?.type === "date") return dateRange(v) === null;
  return false;
}

export type Labels = {
  /** The name behind a person, page or todo id. */
  person: (id: number) => string;
  page: (id: number) => string;
  todo: (id: number) => string;
  now?: Date;
};
export const noLabels: Labels = { person: (id) => `#${id}`, page: (id) => `#${id}`, todo: (id) => `T-${id}` };

const optionName = (p: Property, id: unknown): string => p.options?.find((o) => o.id === id)?.name ?? (typeof id === "string" ? id : "");

/** A cell as plain text — for display fallbacks, search, export, and what the AI reads. */
export function cellText(p: Property | undefined, v: unknown, labels: Labels = noLabels): string {
  if (!p) return v === null || v === undefined ? "" : String(v);
  if (isEmptyValue(p, v)) return p.type === "checkbox" ? "No" : "";
  switch (p.type) {
    case "select":
    case "status":
      return optionName(p, v);
    case "multi_select":
      return asArray(v).map((x) => optionName(p, x)).join(", ");
    case "checkbox":
      return v ? "Yes" : "No";
    case "number":
      return typeof v === "number" ? formatNumber(p, v) : String(v);
    case "date": {
      const r = dateRange(v);
      return r ? (r.end ? `${r.start} → ${r.end}` : r.start) : "";
    }
    case "person":
      return asArray(v).map((x) => labels.person(Number(x))).join(", ");
    case "relation":
      return asArray(v).map((x) => labels.page(Number(x))).join(", ");
    case "todo":
      return asArray(v).map((x) => labels.todo(Number(x))).join(", ");
    case "created_time":
    case "updated_time":
      return String(v).slice(0, 16).replace("T", " ");
    default:
      if (Array.isArray(v)) return v.map((x) => (typeof x === "number" && p.type === "rollup" ? formatNumber(p, x) : String(x))).join(", ");
      if (typeof v === "number") return formatNumber(p, v);
      return String(v);
  }
}

export function formatNumber(p: Property, n: number): string {
  const r = Math.round(n * 1e6) / 1e6;
  switch (p.format) {
    case "percent":
      return `${Math.round(r * 10000) / 100} %`;
    case "euro":
      return `${r.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
    case "dollar":
      return `$${r.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    case "hours":
      return `${r} h`;
    default:
      return String(r);
  }
}

/** The value of a cell for sorting and grouping: a number, a string, or null (empty). */
function sortKey(p: Property | undefined, v: unknown, row: Row): number | string | null {
  if (!p) return null;
  if (p.type === "created_time") return row.createdAt;
  if (p.type === "updated_time") return row.updatedAt;
  if (isEmptyValue(p, v)) return null;
  switch (p.type) {
    case "number":
    case "rollup":
    case "formula":
      return typeof v === "number" ? v : typeof v === "string" ? v : typeof v === "boolean" ? Number(v) : Array.isArray(v) ? v.length : null;
    case "checkbox":
      return v ? 1 : 0;
    case "date":
      return dateRange(v)?.start ?? null;
    case "select":
    case "status": {
      const i = p.options?.findIndex((o) => o.id === v) ?? -1;
      return i >= 0 ? i : null;
    }
    case "multi_select": {
      const i = p.options?.findIndex((o) => o.id === asArray(v)[0]) ?? -1;
      return i >= 0 ? i : null;
    }
    case "person":
    case "relation":
    case "todo":
      return asArray(v).length;
    default:
      return String(v).toLowerCase();
  }
}

const virtual = (id: string): Property | undefined =>
  id === TITLE ? { id, name: "Title", type: "text" } : id === CREATED ? { id, name: "Created", type: "created_time" } : id === UPDATED ? { id, name: "Edited", type: "updated_time" } : undefined;
const propOrVirtual = (props: Property[], id: string) => propById(props, id) ?? virtual(id);
const cellOf = (row: Row, id: string): unknown => (id === TITLE ? row.title : id === CREATED ? row.createdAt : id === UPDATED ? row.updatedAt : row.cells[id]);

export function sortRows(rows: Row[], sorts: Sort[], props: Property[]): Row[] {
  const active = sorts.filter((s) => propOrVirtual(props, s.prop));
  if (!active.length) return rows;
  return [...rows].sort((a, b) => {
    for (const s of active) {
      const p = propOrVirtual(props, s.prop)!;
      const x = sortKey(p, cellOf(a, s.prop), a);
      const y = sortKey(p, cellOf(b, s.prop), b);
      // Empty ones last, whatever the direction.
      if (x === null || y === null) {
        if (x === y) continue;
        return x === null ? 1 : -1;
      }
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
      if (c) return s.dir === "desc" ? -c : c;
    }
    return a.id - b.id;
  });
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const dayText = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** Monday of the week of d. */
const weekStart = (d: Date) => addDays(startOfDay(d), -((d.getDay() + 6) % 7));

/** The condition choices of a property type — what the filter menu offers. */
export function condsFor(type: PropType | "title"): Cond[] {
  switch (type) {
    case "number":
    case "rollup":
    case "formula":
      return ["eq", "neq", "gt", "lt", "gte", "lte", "is_empty", "not_empty"];
    case "select":
    case "status":
      return ["is", "is_not", "is_empty", "not_empty"];
    case "multi_select":
    case "person":
    case "relation":
    case "todo":
    case "ticket":
      return ["contains", "not_contains", "is_empty", "not_empty"];
    case "date":
    case "created_time":
    case "updated_time":
      return ["is", "before", "after", "on_or_before", "on_or_after", "today", "this_week", "past_week", "past_month", "next_week", "next_month", "is_empty", "not_empty"];
    case "checkbox":
      return ["checked", "unchecked"];
    default:
      return ["contains", "not_contains", "is", "is_not", "starts_with", "ends_with", "is_empty", "not_empty"];
  }
}

export const needsValue = (c: Cond): boolean => !["is_empty", "not_empty", "checked", "unchecked", "past_week", "past_month", "next_week", "next_month", "this_week", "today"].includes(c);

export function matchRule(row: Row, rule: Rule, props: Property[], labels: Labels = noLabels): boolean {
  const p = propOrVirtual(props, rule.prop);
  if (!p) return true;
  const v = cellOf(row, rule.prop);
  const cond = rule.cond;
  const empty = p.type === "created_time" || p.type === "updated_time" ? false : isEmptyValue(p, v);
  if (cond === "is_empty") return empty;
  if (cond === "not_empty") return !empty;
  if (cond === "checked") return !!v;
  if (cond === "unchecked") return !v;
  const want = rule.value;
  switch (p.type) {
    case "number":
    case "rollup":
    case "formula": {
      if (typeof v !== "number" && typeof want !== "string" && typeof want !== "number") return false;
      const a = typeof v === "number" ? v : Number(v);
      const b = Number(want);
      if (Number.isNaN(a) || Number.isNaN(b) || want === "" || want === undefined) return p.type === "formula" || p.type === "rollup" ? matchText(cellText(p, v, labels), cond, String(want ?? "")) : false;
      return cond === "eq" ? a === b : cond === "neq" ? a !== b : cond === "gt" ? a > b : cond === "lt" ? a < b : cond === "gte" ? a >= b : cond === "lte" ? a <= b : true;
    }
    case "select":
    case "status":
      return cond === "is" ? v === want : cond === "is_not" ? v !== want : true;
    case "multi_select":
    case "person":
    case "relation":
    case "todo":
    case "ticket": {
      const has = asArray(v).some((x) => x === want || String(x) === String(want));
      return cond === "contains" ? has : cond === "not_contains" ? !has : true;
    }
    case "date":
    case "created_time":
    case "updated_time":
      return matchDate(p.type === "date" ? dateRange(v) : { start: String(p.type === "created_time" ? row.createdAt : row.updatedAt) }, cond, want, labels.now ?? new Date());
    case "checkbox":
      return true;
    default:
      return matchText(rule.prop === TITLE ? row.title : cellText(p, v, labels), cond, String(want ?? ""));
  }
}

function matchText(text: string, cond: Cond, want: string): boolean {
  const t = text.toLowerCase();
  const w = want.toLowerCase();
  switch (cond) {
    case "contains":
      return t.includes(w);
    case "not_contains":
      return !t.includes(w);
    case "is":
      return t === w;
    case "is_not":
      return t !== w;
    case "starts_with":
      return t.startsWith(w);
    case "ends_with":
      return t.endsWith(w);
    default:
      return true;
  }
}

function matchDate(r: { start: string; end?: string } | null, cond: Cond, want: unknown, now: Date): boolean {
  if (!r) return false;
  const start = r.start.slice(0, 10);
  const end = (r.end ?? r.start).slice(0, 10);
  const today = startOfDay(now);
  const within = (from: Date, to: Date) => end >= dayText(from) && start <= dayText(to);
  const w = typeof want === "string" ? want.slice(0, 10) : "";
  switch (cond) {
    case "is":
      return !!w && start <= w && w <= end;
    case "before":
      return !!w && start < w;
    case "after":
      return !!w && end > w;
    case "on_or_before":
      return !!w && start <= w;
    case "on_or_after":
      return !!w && end >= w;
    case "today":
      return within(today, today);
    case "this_week":
      return within(weekStart(today), addDays(weekStart(today), 6));
    case "past_week":
      return within(addDays(today, -7), today);
    case "past_month":
      return within(addDays(today, -30), today);
    case "next_week":
      return within(today, addDays(today, 7));
    case "next_month":
      return within(today, addDays(today, 30));
    default:
      return true;
  }
}

export function matchFilter(row: Row, f: Filter, props: Property[], labels: Labels = noLabels): boolean {
  if (!f.rules.length) return true;
  const test = (r: Rule | Filter) => (isFilter(r) ? matchFilter(row, r, props, labels) : matchRule(row, r, props, labels));
  return f.op === "or" ? f.rules.some(test) : f.rules.every(test);
}

export const filterRows = (rows: Row[], f: Filter, props: Property[], labels: Labels = noLabels): Row[] => (f.rules.length ? rows.filter((r) => matchFilter(r, f, props, labels)) : rows);

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

// ---------------------------------------------------------------------------
// A row's detail view: the modules its database shows
// ---------------------------------------------------------------------------

/**
 * What a row's detail view shows, in order: the database's choice — else by its kind: a database a sync keeps from Jira the
 * briefing panel as Jira Lage had it; a board its cards' briefing and todos; any other its properties and page.
 */
export function detailModules(schema: DbSchema, source: string | null | undefined): DetailModule[] {
  if (schema.detail) return schema.detail;
  if (source === "jira") return ["properties", "briefing", "todos", "questions", "actions", "flags", "context", "chat"];
  const status = schema.properties.find((p) => p.type === "status");
  const board = !!status && schema.views.some((v) => v.type === "board" && v.groupBy === status.id);
  // Subtasks: on a board (as Kanban had them), and wherever rows have a parent already.
  const parents = schema.properties.some((p) => p.type === "relation" && p.relationDb !== undefined && !p.backOf && p.name === "Parent");
  return board ? ["properties", "subtasks", "briefing", "todos", "page"] : parents ? ["properties", "subtasks", "page"] : ["properties", "page"];
}

/** A module shown (at the end) or not any more. */
export const toggleDetail = (list: DetailModule[], m: DetailModule): DetailModule[] => (list.includes(m) ? list.filter((x) => x !== m) : [...list, m]);

/** A module one place up (-1) or down (1). */
export function moveDetail(list: DetailModule[], m: DetailModule, dir: -1 | 1): DetailModule[] {
  const i = list.indexOf(m);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

// ---------------------------------------------------------------------------
// People: whose a row is — the chips to filter by, "mine"
// ---------------------------------------------------------------------------

const PERSON_NAMES = /^(assignee|zuständig|owner|person|bearbeiter|verantwortlich)$/i;

/** The property that says whose a row is: the one set, else the first person property, else a text one named Assignee (Zuständig …). */
export function personPropOf(schema: DbSchema): Property | undefined {
  const set = schema.personProp ? schema.properties.find((p) => p.id === schema.personProp) : undefined;
  return set ?? schema.properties.find((p) => p.type === "person") ?? schema.properties.find((p) => p.type === "text" && PERSON_NAMES.test(p.name.trim()));
}

/** A row's people as keys: person ids, or a name (any case, trimmed) — [] when nobody. */
export function personKeys(row: Row, p: Property): string[] {
  const v = row.cells[p.id];
  if (p.type === "person") return asArray(v).map((x) => String(Number(x))).filter((x) => x !== "0" && x !== "NaN");
  const name = typeof v === "string" ? v.trim().toLowerCase() : "";
  return name ? [name] : [];
}

/** The people on these rows with their counts (most first), nobody ("") last when there are rows without. `label`: a person id's name. */
export function personChips(rows: Row[], p: Property, label: (key: string) => string): { key: string; label: string; count: number }[] {
  const seen = new Map<string, { key: string; label: string; count: number }>();
  let nobody = 0;
  for (const r of rows) {
    const keys = personKeys(r, p);
    if (!keys.length) nobody++;
    for (const k of keys) {
      const c = seen.get(k) ?? { key: k, label: p.type === "person" ? label(k) : String(r.cells[p.id]).trim(), count: 0 };
      c.count++;
      seen.set(k, c);
    }
  }
  const list = [...seen.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return nobody ? [...list, { key: "", label: "", count: nobody }] : list;
}

/** The rows of any of these people ("" for nobody). */
export const filterByPeople = (rows: Row[], p: Property, keys: Set<string>): Row[] =>
  rows.filter((r) => {
    const own = personKeys(r, p);
    return own.length ? own.some((k) => keys.has(k)) : keys.has("");
  });

/** Your keys for a person property: your names (a text one), your person ids (a person one). */
export const mineKeys = (p: Property, me: { names: string[]; ids: number[] }): Set<string> =>
  new Set(p.type === "person" ? me.ids.map(String) : me.names.map((n) => n.trim().toLowerCase()).filter(Boolean));

/** The pinned rows (a note's pin: the property `pinned`) apart from the others — Keep's "Pinned" and "Others". */
export function splitPinned(rows: Row[]): { pinned: Row[]; others: Row[] } {
  const pinned = rows.filter((r) => r.cells.pinned === true);
  return { pinned, others: rows.filter((r) => r.cells.pinned !== true) };
}

/** A due date's alarm on a card (as Kanban's ⏰): past it "overdue", on the day "today" — none once the row is done. `today`: YYYY-MM-DD. */
export function dueTone(v: unknown, today: string, done: boolean): "overdue" | "today" | null {
  const r = done ? null : dateRange(v);
  if (!r) return null;
  const day = r.start.slice(0, 10);
  return day < today ? "overdue" : day === today ? "today" : null;
}

/**
 * Subtasks per parent row: the rows pointing at it through a relation to their own database (a
 * moved Kanban card's Parent) — done when their status is in the done group. By the parent's id.
 */
export function subtaskCounts(schema: DbSchema, rows: Row[], dbId: number): Record<number, { done: number; total: number }> {
  const parents = schema.properties.filter((p) => p.type === "relation" && p.relationDb === dbId && !p.backOf);
  const status = schema.properties.find((p) => p.type === "status");
  const out: Record<number, { done: number; total: number }> = {};
  for (const r of rows) {
    const done = !!status && status.options?.find((o) => o.id === r.cells[status.id])?.group === "done";
    for (const p of parents)
      for (const id of asArray(r.cells[p.id]).map(Number).filter((n) => n > 0 && n !== r.id)) {
        const c = (out[id] ??= { done: 0, total: 0 });
        c.total++;
        if (done) c.done++;
      }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Computed properties
// ---------------------------------------------------------------------------

/** What another database offers a rollup: its schema and its rows (stored values). */
export type DbLookup = (dbId: number) => { schema: DbSchema; rows: Row[] } | null;

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
export function computeRows(schema: DbSchema, rows: Row[], lookup: DbLookup, selfId: number, depth = 0, now = new Date()): Row[] {
  const props = schema.properties;
  if (!props.some(isComputed)) return rows;
  const byRow = new Map<number, Row>();
  const out = rows.map((r) => {
    const copy: Row = { ...r, cells: { ...r.cells } };
    byRow.set(copy.id, copy);
    return copy;
  });
  // Related databases, computed once (a rollup of a formula there needs it computed; deeper than 2 is left null).
  const related = new Map<number, { schema: DbSchema; rows: Row[] } | null>();
  const other = (dbId: number) => {
    if (!related.has(dbId)) {
      const d = dbId === selfId ? { schema, rows } : lookup(dbId);
      related.set(dbId, d);
    }
    return related.get(dbId) ?? null;
  };
  const computedOther = new Map<number, Row[]>();
  const rowsOf = (dbId: number, needComputed: boolean): Row[] => {
    const d = other(dbId);
    if (!d) return [];
    if (!needComputed || depth >= 2 || dbId === selfId) return dbId === selfId ? out : d.rows;
    if (!computedOther.has(dbId)) computedOther.set(dbId, computeRows(d.schema, d.rows, lookup, dbId, depth + 1, now));
    return computedOther.get(dbId)!;
  };

  // 1. Back relations.
  for (const p of props) {
    if (p.type !== "relation" || !p.backOf || p.relationDb === undefined) continue;
    const d = other(p.relationDb);
    for (const r of out) r.cells[p.id] = (d?.rows ?? []).filter((x) => asArray(x.cells[p.backOf!]).some((id) => Number(id) === r.id)).map((x) => x.id);
  }
  // 2. Rollups, 3. formulas (by property, memoised; a formula may use a rollup or another formula).
  const done = new Set<string>();
  const busy = new Set<string>();
  const valueOf = (row: Row, p: Property): unknown => {
    if (p.id === TITLE) return row.title;
    if (p.type === "created_time") return row.createdAt;
    if (p.type === "updated_time") return row.updatedAt;
    if (p.type === "formula" || p.type === "rollup") ensure(row, p);
    return row.cells[p.id];
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
        const d = rel?.relationDb !== undefined ? other(rel.relationDb) : null;
        const target = d ? propById(d.schema.properties, p.rollup.property) : undefined;
        const pool = rel?.relationDb !== undefined ? rowsOf(rel.relationDb, !!target && isComputed(target)) : [];
        const picked = ids.map((id) => pool.find((x) => x.id === id)).filter((x): x is Row => !!x);
        const cellsOf = picked.map((x) => (p.rollup!.property === TITLE ? x.title : x.cells[p.rollup!.property]));
        row.cells[p.id] = rollup(p.rollup.fn, p.rollup.property === TITLE ? { id: TITLE, name: "Title", type: "text" } : target, cellsOf);
      } else if (p.type === "formula") {
        const res = evalFormula(p.formula ?? "", {
          now,
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
  for (const p of props) {
    if (p.type === "created_time") for (const r of out) r.cells[p.id] = r.createdAt;
    if (p.type === "updated_time") for (const r of out) r.cells[p.id] = r.updatedAt;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

const csvCell = (s: string) => (/[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** A database as CSV (title first, then the properties in the view's order, hidden ones left out). */
export function rowsToCsv(schema: DbSchema, rows: Row[], view?: View, labels: Labels = noLabels): string {
  const hidden = new Set(view?.hidden ?? []);
  const order = view?.order ?? [];
  const props = [...schema.properties].filter((p) => !hidden.has(p.id)).sort((a, b) => (order.indexOf(a.id) + 1 || 999) - (order.indexOf(b.id) + 1 || 999));
  const lines = [[schema.titleName, ...props.map((p) => p.name)].map(csvCell).join(";")];
  for (const r of rows) lines.push([r.title, ...props.map((p) => cellText(p, r.cells[p.id], labels))].map(csvCell).join(";"));
  return `${lines.join("\n")}\n`;
}
