/**
 * View templates (the Workspace plugin): how an app's view of a database — or a view of any table made by you or the AI — is laid
 * out. The cards' language (tags from a fixed list, {{ values | filters }}, {{#if}}, {{#each}}), grown for a whole view:
 *
 *   <state name="dir" value="owe"/>
 *   <tabs bind="dir" options="owe:Creditors, owed:Debtors"/>
 *   <grid cols=4><tile label="Open" value="{{ app.open | euro }}"/> …</grid>
 *   <list source="rows | where('Status', 'Active') | sort('Due')" select=true><b>{{ title }}</b> {{ Status | chip }}</list>
 *   <selected empty="Pick one">{{ title }} <button action="set" prop="Status" value="Done" label="Done"/></selected>
 *   <part name="debts.table" dir="{{ state.dir }}"/>   <widget id="cases.due" days=14/>
 *
 * What it sees: `rows` (the view's rows, a collection), `state.*` (the view's own state — tabs, search, the row picked), `app.*`
 * (what the app loaded: figures, lists), `db.*`. A template becomes a tree of known nodes (VNode) — buttons carry what they do and the
 * row they act on, lists their items' rows, a table its rows and columns, a chart its data — that the page draws and runs with its own
 * components. No script, no raw HTML. Client-safe.
 */
import { evalFormula, FORMULA_FUNCTIONS } from "./formula";
import { markdownNodes } from "./view-markdown";
import { layoutGraph, type GraphNodeIn } from "./view-graph";
import { checkWidgetHtml, WIDGET_LIBS } from "@/lib/widgets/sandbox";
import { checkSpec, specHtml, type ExerciseSet } from "@/lib/widgets/spec";
import { MAX_SETTINGS, settingsWithDefaults, type SettingDecl } from "./view-settings";
import { ANY_TAG_ATTRS, cardScope, CARD_TAGS, checkAttr, FILTERS as CARD_FILTERS, isField, isNode, KEYWORDS, numOf, parseFilter, parseTemplate, splitPipes, textOf, type AttrKind, type CardScope, type Ctx as CardCtx, type Field, type TagDef, type TNode, type TplError, type VNode } from "./card-template";
import { noLabels, TITLE, type Labels, type Property, type Row } from "./model";
import { localDay } from "@/lib/dates";
import { blockFlowName, blockSignature, paramValue, type BlockDef } from "./blocks";

export type { VNode, TplError };

/** A building block an app gives its views (drawn by its own component): its name ("debts.table"), what it is, what it takes. */
export type PartMeta = { name: string; description: string; attrs?: Record<string, string> };
/** An action an app adds to the buttons (action="debts.new"). */
export type ActionMeta = { name: string; description: string };

export type ViewData = {
  rows: Row[];
  props: Property[];
  titleName: string;
  /** The view's own state (tabs, search, the row picked …) — strings by name. */
  state: Record<string, string>;
  /** What the app loaded (figures, lists of objects). */
  app: Record<string, unknown>;
  /** What flows gave: a <data name="x">'s output, a button's into="x" — data.x; data.x_status "loading" | "ok" | "error", data.x_error. */
  data?: Record<string, unknown>;
  db: { id: number; title: string };
  now?: Date;
  labels?: Labels;
  /** How numbers and money are written (default de-DE). */
  locale?: string;
  /** A row's own page: the row it is — its fields are names, its buttons and parts act on it. */
  current?: Row;
  /** What the rows' pages say (their first lines), by row id — `text` in a row. */
  texts?: Record<number, string>;
  /** What widgets published for the whole of Zeff (zeff.publish), by name — outputs.<name>. */
  outputs?: Record<string, unknown>;
  /** Translates a text of the template into the user's language (Zeff's language bundles: the English text is the key; {{ x }} in it counts as {0}, {1} …). */
  tr?: (text: string) => string;
  /** The settings saved for this app (name → text) - settings.<name>; a <setting>'s default where nothing was saved. */
  settings?: Record<string, string>;
};

export const MAX_VIEW_TEMPLATE = 60000;

const ACTIONS: Record<string, { row?: boolean; what: string }> = {
  report: { what: "inside a <subview>: its result — score=\"{{ … }}\" (0..1), correct=, total=, feedback=\"…\", finished=true — to the subview's report flow (and the chat it tells), as a code widget's zeff.report" },
  new: { what: 'a new row (values="Status=Active, Amount=5" to start with) — opened' },
  open: { row: true, what: "open the row's page" },
  set: { row: true, what: 'set a property: prop="Status" value="Done"' },
  toggle: { row: true, what: 'flip a checkbox: prop="Done"' },
  delete: { row: true, what: "move the row to the trash (asks first)" },
  duplicate: { row: true, what: "a copy of the row" },
  hide: { row: true, what: "hide the row from the views" },
  state: { what: 'set the view\'s state: state="dir" value="owed"' },
  select: { row: true, what: "pick the row (state.selected) — <selected> shows it" },
  url: { what: 'go to an address: href="/todos"' },
  print: { what: "print the view (a PDF)" },
  reload: { what: "read the data again (every <data> on the screen too — the blocks beside it on a page)" },
  say: { what: 'say something into a plugin’s live chat (the one a <chat> shows): chat="plugin.chat" key="{{ … }}" text="Give me a hint" — a chat that has not begun begins with it (title= names it)' },
  assistant: { what: 'hand a request to the Workspace assistant, who works it through with all its tools in the background: request="…", what was typed in it with {{ state.name }} (not in a row: a row\'s text must not become a request)' },
};

const T = (attrs: Record<string, AttrKind>, isVoid = false): TagDef => ({ attrs, void: isVoid });
const ANY: Record<string, AttrKind> = new Proxy({}, { get: () => "text" as const, has: () => true }) as Record<string, AttrKind>;

/** The tags of a view: a card's, and those for a page. */
export const VIEW_TAGS: Record<string, TagDef> = {
  ...CARD_TAGS,
  // A sidebar of entries: drawn beside the view, or (the view's setting) under its database in the Workspace tree.
  nav: T({ title: "text" }),
  entry: T({ id: "text", label: "text", icon: "text", row: "text", state: "text", value: "text", href: "url", n: "text", group: "text" }, true),
  row: T({ fill: { oneOf: ["true", "false"] }, tip: "text", gap: "int", align: { oneOf: ["start", "center", "end", "baseline"] }, wrap: { oneOf: ["true", "false"] }, justify: { oneOf: ["start", "between", "end"] } }),
  grid: T({ cols: "int", gap: "int", min: "int" }),
  col: T({ gap: "int", fill: { oneOf: ["true", "false"] }, width: "int", tip: "text", align: { oneOf: ["start", "center", "end"] }, max: "text" }),
  truncate: T({ tip: "text" }),
  mono: T({ tip: "text" }),
  b: T({ tip: "text" }),
  small: T({ tip: "text" }),
  muted: T({ tip: "text" }),
  // open=wide: open on a wide screen, folded on a phone.
  section: T({ title: "text", aside: "text", collapsible: { oneOf: ["true", "false"] }, open: { oneOf: ["true", "false", "wide"] }, scroll: "int" }),
  strike: T({}),
  box: T({ title: "text", tone: { oneOf: ["plain", "muted", "good", "warn", "bad"] }, scroll: "int" }),
  heading: T({ level: { oneOf: ["1", "2", "3"] } }),
  text: T({ tone: { oneOf: ["plain", "muted", "good", "warn", "bad"] }, tip: "text", pre: { oneOf: ["true", "false"] } }),
  tile: T({ label: "text", value: "text", sub: "text", tone: { oneOf: ["plain", "good", "warn", "bad"] }, tip: "text", icon: "text", trend: "text", spark: "text" }),
  bar: T({ value: "num", max: "num", color: "color", fill: "paint" }, true),
  dot: T({ color: "paint" }, true),
  printonly: T({}),
  noprint: T({}),
  datatable: T({ source: "list", empty: "text" }),
  column: T({ label: "text", align: { oneOf: ["left", "right", "center"] }, foot: "text", nowrap: { oneOf: ["true", "false"] }, width: "int" }),
  state: T({ name: "text", value: "text" }, true),
  tabs: T({ bind: "text", options: "text" }, true),
  split: T({ ratio: { oneOf: ["1:1", "1:2", "2:1", "2:3", "3:2", "1:3", "3:1"] }, side: { oneOf: ["left", "right"] }, width: "int" }),
  // grid: the rows share one grid of these columns ("max-content minmax(0,80ch) 1fr max-content") — each as wide as its widest cell.
  list: T({ spacing: { oneOf: ["compact", "roomy"] }, source: "list", select: { oneOf: ["true", "false"] }, open: { oneOf: ["true", "false"] }, empty: "text", grid: "text", page: "int", more: "text" }),
  cards: T({ spacing: { oneOf: ["compact", "roomy"] }, source: "list", cols: "int", open: { oneOf: ["true", "false"] }, select: { oneOf: ["true", "false"] }, empty: "text", page: "int", more: "text" }),
  // The bigger blocks (ui/view-blocks.tsx).
  header: T({ title: "text", subtitle: "text", icon: "text" }),
  toolbar: T({}),
  // A ⋯ button whose dropdown holds the children (toggles, buttons used now and then).
  menu: T({ label: "text", tip: "text" }),
  // A channel's mark (Gmail, Outlook, Teams, WhatsApp, Signal, any mailbox): ui ChannelLogo.
  logo: T({ name: "text", size: { oneOf: ["sm", "lg"] } }, true),
  // In a row: whether it flowed into todos — a dot for one, a badge with their number for several (ui TodoMark).
  todomark: T({}, true),
  panes: T({}),
  pane: T({ title: "text", aside: "text", width: "int", flush: { oneOf: ["true", "false"] } }),
  cover: T({ src: "url", h: "int", title: "text", subtitle: "text" }, true),
  callout: T({ tone: { oneOf: ["info", "good", "warn", "bad"] }, title: "text", icon: "text" }),
  empty: T({ icon: "text", title: "text", text: "text" }),
  kv: T({ min: "int" }),
  pair: T({ label: "text" }),
  avatar: T({ src: "url", name: "text", size: "int" }, true),
  quote: T({ cite: "text" }),
  divider: T({ label: "text" }, true),
  progress: T({ value: "num", max: "num", label: "text", tone: { oneOf: ["info", "good", "warn", "bad"] }, show: { oneOf: ["true", "false"] } }, true),
  sparkline: T({ values: "text", wide: { oneOf: ["true", "false"] } }, true),
  steps: T({}),
  step: T({ title: "text", state: { oneOf: ["done", "active", "todo"] } }),
  gallery: T({ source: "list", image: "list", alt: "list", ratio: { oneOf: ["2:3", "1:1", "16:9", "3:2"] }, min: "int", empty: "text", page: "int", more: "text" }),
  timeline: T({ source: "list", date: "list", empty: "text", page: "int", more: "text", /** Per item: left | right | center — the items stand on both sides of a line down the middle. */ side: "list", /** Per item: the colour of its dot (indigo, zinc, emerald, amber, red). */ dot: "list" }),
  board: T({ source: "list", group: "text", none: "text" }),
  groups: T({ source: "list", by: "text", none: "text" }),
  facets: T({ bind: "text", field: "text", source: "list", all: "text", label: "text" }, true),
  quickadd: T({ placeholder: "text", label: "text", values: "text" }, true),
  form: T({ fields: "text", title: "text", label: "text", done: "text" }, true),
  table: T({ source: "list", columns: "text", sum: "text", empty: "text" }, true),
  chart: T({ source: "list", kind: { oneOf: ["bar", "column", "line", "pie"] }, group: "text", value: "text", calc: { oneOf: ["count", "sum", "avg"] } }, true),
  selected: T({ empty: "text" }),
  button: T({ action: "text", label: "text", icon: "text", request: "text", row: "text", prop: "text", value: "text", values: "text", state: "text", href: "url", confirm: "text", variant: { oneOf: ["primary", "plain", "quiet", "danger", "link"] }, print: { oneOf: ["true", "false"] }, tip: "text", disabled: { oneOf: ["true", "false"] }, wide: { oneOf: ["true", "false"] }, keys: "text", emit: "text", run: "text", with: "text", into: "text", done: "text", then: "text", transition: "text", note: { oneOf: ["true", "false"] }, score: "text", correct: "text", total: "text", feedback: "text", finished: { oneOf: ["true", "false"] }, chat: "text", key: "text", text: "text", title: "text" }, true),
  // A flow's output loaded into data.<name> — again whenever what it is called with changes (flows/).
  data: T({ name: "text", flow: "text", lambda: "text", with: "text", when: "text", debounce: "int", every: "int" }, true),
  // A row's lifecycle: its transitions as buttons (only those it can take now enabled) and its way so far.
  transitions: T({ history: { oneOf: ["true", "false"] } }, true),
  search: T({ bind: "text", placeholder: "text" }, true),
  // A field that finds things elsewhere: the one picked becomes a row (lookup-point.ts).
  // A database as a body of knowledge (dossier.ts): a question to its rows, what they say together.
  ask: T({ placeholder: "text", suggest: "text", intro: "text" }, true),
  dossier: T({ focus: "text", empty: "text", plain: { oneOf: ["true", "false"] } }, true),
  lookup: T({ source: "text", map: "text", placeholder: "text", unique: "text", language: "text", open: { oneOf: ["true", "false"] } }, true),
  select: T({ bind: "text", options: "text", label: "text", /** Typed to find (an autocomplete), as wide as there is room. */ search: { oneOf: ["true", "false"] } }, true),
  toggle: T({ bind: "text", label: "text" }, true),
  field: T({ name: "text" }, true),
  part: T(ANY),
  widget: T(ANY, true),
  // Blocks of your own (blocks.ts): <use block="name" param=…>what goes into its <slot/></use>, <fill slot="x"> for a named one.
  use: T(ANY),
  slot: T({ name: "text" }, true),
  fill: T({ slot: "text" }),
  // A name for a value from here on (its siblings after it and what is inside them): <let name="open" value="rows | where(…)"/>.
  let: T({ name: "text", value: "list" }, true),
  // A function of your own (value-returning, may call itself - within a budget): <def name="fact" args="n" value="if(n <= 1, 1, n * fact(n - 1))"/>.
  def: T({ name: "text", args: "text", value: "text" }, true),
  // Rich text: Markdown as the view's own nodes (headings, bold, italic, code, links, lists, quotes) - no HTML.
  // (Its text may be long — a message with an exercise in it: kept whole, up to what markdownNodes reads, not cut at 4000 as a label.)
  markdown: T({ value: "code" }, true),
  // A widget written by anyone (the AI, a teacher): its code from the data, in the sandboxed frame - no network, no access to Zeff, only
  // results (zeff.report) that come back as a flow run: report="flow" with="exercise={{ id }}" (+ score, correct, total, note, done, answers).
  // A live chat with an agent (a plugin's manifest chats): the box under a conversation that the view shows from its database - starts on the first
  // message, shows the session as it speaks, takes the next message. bump="n" names the state that is counted up when the conversation grew.
  // Things that depend on each other, laid out in columns (a skill tree, a plan, a process): one node per item of source; id, label, requires (the ids
  // it needs), group (bands), color, state (done / locked / open), progress (0..1 ring), ring (text in it) are fields; thread: ids in order.
  graph: T({ source: "list", id: "text", label: "text", requires: "text", group: "text", color: "text", state: "text", progress: "text", ring: "text", thread: "list", walked: "int", bind: "text", emit: "text", empty: "text", /** map: a dependency map (nodes with their parts) in a sideways scrolling strip; its data: source = [{ key, title, status, path, group, after, foundation, summary, steps }], groups = [{ key, title }], route = { keys, walked }. */ look: { oneOf: ["graph", "map"] }, groups: "list", route: "text", stepbind: "text", stepemit: "text" }, true),
  // Things with a time as a calendar (day, week — hours, side by side where they overlap —, month, agenda): open, move, drag a new one.
  schedule: T({ source: "list", start: "text", end: "text", title: "text", id: "text", color: "text", allday: "text", editable: "text", view: "text", day: "text", bind: "text", emit: "text", move: "text", create: "text", daybind: "text", empty: "text" }, true),
  chat: T({ chat: "text", key: "text", title: "text", first: "text", placeholder: "text", begin: "text", bump: "text", write: { oneOf: ["true", "false"] }, quiet: { oneOf: ["true", "false"] } }, true),
  codewidget: T({ html: "code", spec: "code", libs: "text", title: "text", height: "int", report: "text", with: "text", fail: "text", tell: "text", tellkey: "text", kind: "text" }, true),
  // A view template from the data (an exercise the AI wrote), drawn here with its own state; its <button action="report"> sends a result like a code widget's.
  subview: T({ template: "code", title: "text", report: "text", with: "text", tell: "text", tellkey: "text", kind: "text" }, true),
  // A file chosen by the user, read as text into state.<bind> (its name in state.<bind>_name): a CSV, a JSON, a text.
  // How the view looks: its accent colour (#rrggbb), the roundness of its corners and its font - on the view only.
  theme: T({ accent: "text", radius: { oneOf: ["none", "sm", "md", "lg"] }, font: { oneOf: ["sans", "serif", "mono"] } }, true),
  // Drag and drop: what is inside <drag value="…"> can be picked up; <drop bind="x" emit="moved"> takes it: state.x is the value, the event is sent.
  drag: T({ value: "text", tip: "text" }),
  drop: T({ bind: "text", emit: "text", label: "text" }),
  // Settings of the app: declared with <setting>, edited in <settings/>, read as settings.<name>.
  setting: T({ name: "text", label: "text", type: { oneOf: ["text", "number", "toggle", "select"] }, options: "text", default: "text" }, true),
  settings: T({ title: "text" }, true),
  upload: T({ bind: "text", label: "text", accept: "text", max: "int" }, true),
  switch: T({ on: "text" }),
  case: T({ value: "text" }),
  otherwise: T({}),
  // Tabs that hold their content (only the tab shown is drawn).
  tabset: T({ bind: "text" }),
  tab: T({ id: "text", label: "text", n: "text" }),
  // A dialog (center) or a drawer (side=right), open while state.<bind> is filled.
  dialog: T({ bind: "text", title: "text", side: { oneOf: ["center", "right"] }, wide: { oneOf: ["true", "false"] } }),
  input: T({ bind: "text", type: { oneOf: ["text", "number", "date", "time", "month", "color", "textarea", "email", "url"] }, label: "text", placeholder: "text", value: "text" }, true),
  slider: T({ bind: "text", min: "num", max: "num", step: "num", label: "text", value: "text", unit: "text" }, true),
  calendar: T({ source: "list", date: "list", bind: "text", empty: "text" }),
  heatmap: T({ source: "list", date: "list", value: "list", calc: { oneOf: ["count", "sum"] }, weeks: "int", label: "text", unit: "text" }, true),
  pivot: T({ source: "list", rows: "list", cols: "list", value: "list", calc: { oneOf: ["count", "sum", "avg"] }, format: "text", total: { oneOf: ["true", "false"] }, empty: "text" }, true),
  gauge: T({ value: "num", max: "num", label: "text", sub: "text", tone: { oneOf: ["info", "good", "warn", "bad"] }, size: "int" }, true),
  rating: T({ value: "text", max: "int", prop: "text" }, true),
  copy: T({ text: "text", label: "text" }, true),
};

// An event handler: <on event="saved" action="state" state="msg" value="Saved"/> does what a button does when a button says emit="saved" (or a
// key is pressed: <on keys="mod+s" run="my.save"/>). Same attributes as a button.
VIEW_TAGS.on = T({ ...VIEW_TAGS.button.attrs, event: "text" }, true);
// A box (a card) can be what you click: it does what a button does (<box action="state" state="course" value="…">).
VIEW_TAGS.box = T({ ...VIEW_TAGS.box.attrs, tone: { oneOf: ["plain", "muted", "good", "warn", "bad", "accent"] }, ...Object.fromEntries(["action", "state", "value", "emit", "run", "with", "into", "done", "then", "confirm", "href", "tip"].map((k) => [k, VIEW_TAGS.button.attrs[k]])) });

/** The tags whose attribute names a state (or a data name): in a block, each use keeps its own. */
const STATE_KEYS: Record<string, string[]> = {
  state: ["name"],
  tabs: ["bind"],
  select: ["bind"],
  search: ["bind"],
  toggle: ["bind"],
  facets: ["bind"],
  tabset: ["bind"],
  dialog: ["bind"],
  input: ["bind"],
  graph: ["bind", "stepbind"],
  schedule: ["bind", "daybind"],
  upload: ["bind"],
  drop: ["bind"],
  slider: ["bind"],
  calendar: ["bind"],
  data: ["name"],
  entry: ["state"],
  button: ["state", "into"],
  box: ["state", "into"],
};
/** How deep blocks may stand in blocks. */
const MAX_BLOCK_DEPTH = 6;

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

/** The rows (or a part of them) as one value — filters narrow, sort, count and sum them. */
class RowList {
  constructor(readonly rows: Row[]) {}
}
const isRows = (v: unknown): v is RowList => v instanceof RowList;

type Ctx = {
  data: ViewData;
  state: Record<string, string>;
  /** The row the tags are in (a list's item, <selected>): buttons act on it, its fields are names. */
  row: Row | null;
  /** An item of an app's list (an object): its fields are names. */
  item: Record<string, unknown> | null;
  locals: Map<string, Field>;
  errors: TplError[];
  parts: Set<string>;
  actions: Set<string>;
  scopes: Map<number, CardScope>;
  /** What <let> named (from there on). */
  vars: Map<string, unknown>;
  /** The functions <def> made (from there on), by lower-case name. */
  fns: Map<string, UserFn>;
  /** What all the functions together may use up while one view is drawn. */
  budget: { calls: number; depth: number };
  /** What <setting> declared (shared by the whole drawing). */
  decls: SettingDecl[];
  /** The blocks of your own, by name — null: not known yet (a <use> draws nothing, and says nothing). */
  blocks: Map<string, BlockDef> | null;
  /** Inside a block: its use's own state's prefix ("_b3_"), its parameters, what goes into its slots, the blocks it stands in. */
  prefix: string;
  block: { name: string; props: Record<string, unknown>; slots: Map<string, { nodes: TNode[]; ctx: Ctx }> } | null;
  /** Inside a <subview>: where its result goes (its report flow, with=, the chat it tells). */
  report?: Record<string, string> | null;
  stack: string[];
  seq: { n: number };
};

const norm = (s: string) => s.trim().toLowerCase();

/** A function of the view's own: its parameters, its body (a formula, or a pipe when it has a "|") and the names it saw when it was made. */
type UserFn = { name: string; params: string[]; body: string; vars: Map<string, unknown>; line: number };
/** How many calls one view may make (all functions together), and how deep they may stand in each other. */
export const MAX_FN_CALLS = 20000;
export const MAX_FN_DEPTH = 100;

/** Calls a function of the view's own: positional arguments; its answer is the body's value. Throws what goes wrong (and when the budget is gone). */
function callUser(ctx: Ctx, name: string, args: unknown[]): unknown {
  const f = ctx.fns.get(norm(name));
  if (!f) throw new Error(`There is no function “${name}” (<def name="${name}" args="…" value="…"/> makes one).`);
  const b = ctx.budget;
  if (++b.calls > MAX_FN_CALLS) throw new Error(`“${name}” and the functions with it need too much work (more than ${MAX_FN_CALLS} calls in one view).`);
  if (b.depth >= MAX_FN_DEPTH) throw new Error(`“${name}” goes too deep (more than ${MAX_FN_DEPTH} calls inside each other) — a function that calls itself needs a case where it stops.`);
  const vars = new Map(f.vars);
  f.params.forEach((p, i) => vars.set(norm(p), args[i] ?? null));
  const inner: Ctx = { ...ctx, vars, errors: [] };
  b.depth++;
  try {
    const body = f.body.trim().replace(/^\{\{([\s\S]*)\}\}$/, "$1").trim();
    const v = splitPipes(body).length > 1 ? pipe(body, inner, f.line) : evaluate(body, inner, f.line);
    if (inner.errors.length) throw new Error(`${name}: ${inner.errors[0].message}`);
    return v;
  } finally {
    b.depth--;
  }
}

/** The functions made so far, offered to the formulas' language (it asks by name). */
const userFnReader = (ctx: Ctx) => (name: string) => (ctx.fns.has(norm(name)) ? { call: (args: unknown[]) => callUser(ctx, name, args) as never } : null);

function scopeOf(ctx: Ctx, row: Row): CardScope {
  let s = ctx.scopes.get(row.id);
  if (!s) {
    s = cardScope({ row, props: ctx.data.props, titleName: ctx.data.titleName, labels: ctx.data.labels ?? noLabels, now: ctx.data.now, text: ctx.data.texts?.[row.id] ?? "" });
    ctx.scopes.set(row.id, s);
  }
  return s;
}

const fieldOf = (ctx: Ctx, row: Row, name: string): Field | undefined => scopeOf(ctx, row).get(name);
const propByName = (ctx: Ctx, name: string): Property | undefined => {
  const w = norm(name.replace(/^\[|\]$/g, ""));
  return ctx.data.props.find((p) => norm(p.name) === w || p.id === name.trim());
};

/** A path's value: `rows`, `state.x`, `app.a.b`, `db.title`, `this`, a field of the row or item the tags are in. */
function resolve(ctx: Ctx, path: string): { found: boolean; value: unknown } {
  const p = path.trim();
  const local = ctx.locals.get(norm(p));
  if (local) return { found: true, value: local };
  const [head, ...rest] = p.split(".");
  const h = norm(head);
  const walk = (v: unknown, keys: string[]): unknown => keys.reduce<unknown>((o, k) => (o && typeof o === "object" && !Array.isArray(o) && !isRows(o) ? (o as Record<string, unknown>)[k] : undefined), v);
  if (ctx.vars.has(h)) return { found: true, value: rest.length ? (walk(ctx.vars.get(h), rest) ?? null) : ctx.vars.get(h) };
  if (h === "props" && ctx.block) {
    if (!rest.length) return { found: true, value: ctx.block.props };
    const key = Object.keys(ctx.block.props).find((k) => norm(k) === norm(rest[0]));
    return key === undefined ? { found: false, value: null } : { found: true, value: rest.length > 1 ? (walk(ctx.block.props[key], rest.slice(1)) ?? null) : ctx.block.props[key] };
  }
  if (h === "rows" && !rest.length) return { found: true, value: new RowList(ctx.data.rows) };
  if (h === "state") {
    if (rest.length) return { found: true, value: ctx.state[ctx.prefix + rest.join(".")] ?? null };
    // (Inside a block: its own state, by the names it gave it.)
    return { found: true, value: ctx.prefix ? Object.fromEntries(Object.entries(ctx.state).filter(([k]) => k.startsWith(ctx.prefix)).map(([k, v]) => [k.slice(ctx.prefix.length), v])) : ctx.state };
  }
  if (h === "app") return { found: true, value: walk(ctx.data.app, rest) ?? null };
  if (h === "outputs") {
    const all = ctx.data.outputs ?? {};
    if (!rest.length) return { found: true, value: all };
    // (By its name as published — "Monthly total" — or its key: monthly-total, monthly_total.)
    const want = rest[0].toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const k = Object.keys(all).find((x) => x === rest[0] || x.toLowerCase().replace(/[^a-z0-9]+/g, "-") === want);
    return { found: true, value: k === undefined ? null : rest.length > 1 ? (walk(all[k], rest.slice(1)) ?? null) : all[k] };
  }
  if (h === "settings") {
    const all = settingsWithDefaults(ctx.decls, ctx.data.settings);
    // (Saved values of settings the view declares no more are not shown.)
    return { found: true, value: rest.length ? (all[rest[0]] ?? ctx.data.settings?.[rest[0]] ?? null) : all };
  }
  if (h === "data") return { found: true, value: (rest.length ? walk(ctx.data.data ?? {}, [ctx.prefix + rest[0], ...rest.slice(1)]) : ctx.data.data) ?? null };
  if (h === "db") return { found: true, value: walk(ctx.data.db, rest) ?? null };
  if (h === "now") return { found: true, value: localDay(ctx.data.now ?? new Date()) };
  if (h === "this") return { found: true, value: ctx.item ? walk(ctx.item, rest) : ctx.row ? (rest.length ? fieldOf(ctx, ctx.row, rest.join(".")) : ctx.row.title) : null };
  if (ctx.item && head in ctx.item) return { found: true, value: walk(ctx.item, [head, ...rest]) ?? null };
  if (ctx.row && !rest.length) {
    const f = fieldOf(ctx, ctx.row, p);
    if (f) return { found: true, value: f };
  }
  return { found: false, value: null };
}

/** A value as the formulas see it (a field its value, a collection its size). */
const plain = (v: unknown): unknown => (isField(v) ? v.value : isRows(v) ? v.rows.length : v);

/** An expression in the formulas' language, names (with dots: state.dir) written as they are, or [in brackets]. */
function toFormula(expr: string): string {
  let out = "";
  for (let i = 0; i < expr.length; ) {
    const c = expr[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < expr.length && expr[j] !== c) j += expr[j] === "\\" ? 2 : 1;
      out += JSON.stringify(expr.slice(i + 1, j));
      i = j + 1;
    } else if (c === "[") {
      const j = expr.indexOf("]", i);
      if (j < 0) throw new Error("A [ is never closed with ].");
      out += `prop(${JSON.stringify(expr.slice(i + 1, j).trim())})`;
      i = j + 1;
    } else if (/[\p{L}_]/u.test(c)) {
      let j = i;
      while (j < expr.length && /[\p{L}\p{N}_.]/u.test(expr[j])) j++;
      const w = expr.slice(i, j);
      out += KEYWORDS.has(w.toLowerCase()) || expr.slice(j).trimStart()[0] === "(" ? w : `prop(${JSON.stringify(w)})`;
      i = j;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function evaluate(expr: string, ctx: Ctx, line: number): unknown {
  try {
    const r = evalFormula(toFormula(expr), {
      now: ctx.data.now,
      ...(ctx.fns.size ? { fn: userFnReader(ctx) } : {}),
      prop: (name) => {
        const x = resolve(ctx, name);
        if (!x.found) throw new Error(`There is no “${name}”`);
        const v = plain(x.value);
        // (An object of the app — a contact, a payment — is there or not: true when it is.)
        return Array.isArray(v) || v === null || ["string", "number", "boolean"].includes(typeof v) ? v : v === undefined ? null : true;
      },
    });
    if ("error" in r) throw new Error(r.error);
    return r.value instanceof Date ? localDay(r.value) : r.value;
  } catch (e) {
    ctx.errors.push({ line, message: `${expr.trim()}: ${(e as Error).message}` });
    return null;
  }
}

/** The first thing of a pipe: a path is its value (a field, so filters know its property; a collection), anything else evaluated. */
function head(expr: string, ctx: Ctx, line: number): unknown {
  const e = expr.trim();
  const bare = /^\[([^\]]+)\]$/.exec(e)?.[1] ?? (/^[\p{L}_][\p{L}\p{N}_.]*$/u.test(e) && !KEYWORDS.has(e.toLowerCase()) ? e : null);
  if (bare) {
    const x = resolve(ctx, bare);
    if (x.found) return x.value;
    ctx.errors.push({ line, message: `There is no “${bare}” — names are the row's properties, rows, state.…, app.…, db.….` });
    return null;
  }
  return evaluate(e, ctx, line);
}

/** Money as written in the language shown (a plain space before the €, so it reads the same everywhere); `digits`: 0 for whole euros. */
const money = (n: number, locale: string, digits?: number) => n.toLocaleString(locale, { style: "currency", currency: "EUR", ...(digits !== undefined ? { minimumFractionDigits: digits, maximumFractionDigits: digits } : {}) }).replace(/\u00a0/g, " ");

function compare(a: unknown, b: unknown): number {
  const x = plain(a);
  const y = plain(b);
  if (x === null || x === undefined || x === "") return y === null || y === undefined || y === "" ? 0 : 1;
  if (y === null || y === undefined || y === "") return -1;
  if (typeof x === "number" && typeof y === "number") return x - y;
  return textOf(x).localeCompare(textOf(y), undefined, { numeric: true });
}

/** A collection's items as values of a field (a row's property; an object's key). */
function valuesOf(v: unknown, ctx: Ctx, field: string): unknown[] {
  if (isRows(v)) return v.rows.map((r) => fieldOf(ctx, r, field) ?? (field === "title" ? r.title : null));
  if (Array.isArray(v)) return v.map((o) => (o && typeof o === "object" ? (o as Record<string, unknown>)[field] : o));
  return [];
}
const itemsOf = (v: unknown): unknown[] => (isRows(v) ? v.rows : Array.isArray(v) ? v : isField(v) ? (Array.isArray(v.value) ? v.value : v.value === null ? [] : [v.value]) : v === null || v === undefined ? [] : [v]);
const remake = (v: unknown, items: unknown[]): unknown => (isRows(v) ? new RowList(items as Row[]) : items);

function matches(x: unknown, op: string, want: unknown): boolean {
  const v = plain(x);
  const list = Array.isArray(v) ? v : [v];
  const eq = (a: unknown) => (typeof a === "number" && numOf(want) !== null ? a === numOf(want) : norm(textOf(a)) === norm(textOf(want)));
  // (Nothing is not more or less than something: "from today on" leaves out what has no date.)
  const none = v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length);
  if (none && (op === ">" || op === "<" || op === ">=" || op === "<=")) return false;
  switch (op) {
    case "=":
    case "==":
      return list.some(eq);
    case "!=":
      return !list.some(eq);
    case ">":
      return compare(v, want) > 0;
    case "<":
      return compare(v, want) < 0;
    case ">=":
      return compare(v, want) >= 0;
    case "<=":
      return compare(v, want) <= 0;
    case "contains":
      return norm(textOf(v)).includes(norm(textOf(want)));
    case "empty":
      return v === null || v === "" || (Array.isArray(v) && !v.length);
    case "filled":
      return !(v === null || v === "" || (Array.isArray(v) && !v.length));
    case "in": {
      // One of these (want: "a|b|c", or a list).
      const wants = (Array.isArray(want) ? want : textOf(want).split("|")).map((w) => norm(textOf(w)));
      return list.some((x) => wants.includes(norm(textOf(x))));
    }
    default:
      throw new Error(`where: no comparison “${op}” (=, !=, >, <, >=, <=, contains, in, empty, filled)`);
  }
}

const sumOf = (xs: unknown[]) => xs.map((x) => numOf(plain(x))).filter((n): n is number => n !== null);

/** Filters for collections (rows, an app's lists) and the view's values — the cards' filters besides. */
const LIST_FILTERS: Record<string, (v: unknown, a: (string | number)[], ctx: Ctx) => unknown> = {
  // where(), while something is picked: with <facets>, <select>, nothing picked is all of them.
  // The address's site: https://www.example.org/a → example.org.
  host: (v) => {
    try {
      return new URL(textOf(v)).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  },
  only: (v, a, ctx) => (a[1] === undefined || a[1] === "" ? v : LIST_FILTERS.where(v, a, ctx)),
  where: (v, a, ctx) => {
    const [field, x, y] = a.map(String);
    const op = a.length >= 3 ? x : a.length === 2 && (x === "empty" || x === "filled") ? x : "=";
    const want = a.length >= 3 ? y : x;
    const items = itemsOf(v);
    const vals = valuesOf(v, ctx, field);
    return remake(v, items.filter((_, i) => matches(vals[i], op, want)));
  },
  sort: (v, a, ctx) => {
    const vals = valuesOf(v, ctx, String(a[0] ?? "title"));
    const desc = String(a[1] ?? "asc").toLowerCase() === "desc";
    const idx = itemsOf(v).map((x, i) => ({ x, i }));
    // What has no value goes last, either way: "the newest first" doesn't start with what has no date.
    const blank = (x: unknown) => {
      const y = plain(x);
      return y === null || y === undefined || y === "" || (Array.isArray(y) && !y.length);
    };
    idx.sort((p, q) => Number(blank(vals[p.i])) - Number(blank(vals[q.i])) || (desc ? -1 : 1) * compare(vals[p.i], vals[q.i]));
    return remake(v, idx.map((o) => o.x));
  },
  limit: (v, a) => remake(v, itemsOf(v).slice(0, typeof a[0] === "number" ? a[0] : 10)),
  search: (v, a, ctx) => {
    const w = norm(String(a[0] ?? ""));
    if (!w) return v;
    if (isRows(v)) return new RowList(v.rows.filter((r) => norm(r.title).includes(w) || ctx.data.props.some((p) => norm(fieldOf(ctx, r, p.id)?.text ?? "").includes(w))));
    return remake(v, itemsOf(v).filter((o) => norm(JSON.stringify(o)).includes(w)));
  },
  count: (v) => itemsOf(v).length,
  // The items by a field's value: [{ group, count, items }] — {{#each rows | groupby('Status')}}{{ group }} {{ count }}<list source="this.items">…
  groupby: (v, a, ctx) => {
    const vals = valuesOf(v, ctx, String(a[0] ?? ""));
    const buckets = new Map<string, unknown[]>();
    itemsOf(v).forEach((it, i) => {
      const f = vals[i];
      const labels = isField(f) ? (f.text ? f.text.split(", ") : [""]) : Array.isArray(f) ? f.map((y) => textOf(y)) : [textOf(plain(f))];
      for (const label of labels.length ? labels : [""]) buckets.set(label, [...(buckets.get(label) ?? []), it]);
    });
    const out = [...buckets].map(([group, items]) => ({ group: group || String(a[1] ?? "—"), count: items.length, items: remake(v, items) }));
    return String(a[2] ?? "").toLowerCase() === "count" ? out.sort((x, y) => y.count - x.count) : out;
  },
  // A field's values, each once (in the order they come).
  distinct: (v, a, ctx) => [...new Set((a.length ? valuesOf(v, ctx, String(a[0])) : itemsOf(v)).flatMap((x) => (isField(x) ? (x.text ? x.text.split(", ") : []) : [textOf(plain(x))])).filter(Boolean))],
  offset: (v, a) => remake(v, itemsOf(v).slice(typeof a[0] === "number" ? a[0] : 0)),
  reverse: (v) => remake(v, [...itemsOf(v)].reverse()),
  // Between two values (dates, numbers), both included: between('Due', now, '2026-12-31').
  between: (v, a, ctx) => {
    const vals = valuesOf(v, ctx, String(a[0] ?? ""));
    return remake(v, itemsOf(v).filter((_, i) => matches(vals[i], ">=", a[1]) && matches(vals[i], "<=", a[2])));
  },
  // The field of the row (or the item) whose name this is: {{ props.amount | field | euro }} in a block.
  field: (v, _a, ctx) => {
    const name = textOf(plain(v)).trim().replace(/^\[|\]$/g, "");
    if (!name) return null;
    if (ctx.row) return fieldOf(ctx, ctx.row, name) ?? (norm(name) === "title" ? ctx.row.title : null);
    return ctx.item ? (ctx.item[name] ?? null) : null;
  },
  // Lists and objects in the view's state (it keeps texts): {{ state.todo | fromjson | push(state.new) | tojson }} — the buttons' state= value takes the result.
  fromjson: (v) => {
    try {
      return JSON.parse(textOf(plain(v)) || "null") as unknown;
    } catch {
      throw new Error("fromjson: that is not JSON.");
    }
  },
  tojson: (v) => JSON.stringify(isRows(v) ? v.rows.map((r) => ({ id: r.id, title: r.title })) : isField(v) ? v.value : v) ?? "null",
  // The list with something added / the item at a position taken out (the list as it is stays).
  push: (v, a) => [...(Array.isArray(v) ? v : v === null || v === undefined ? [] : itemsOf(v)), ...a],
  drop: (v, a) => itemsOf(v).filter((_, i) => i !== a[0]),
  // The object with a key set; the item at a position or under a key; the keys; how long (a text, a list) or how many keys.
  put: (v, a) => ({ ...(v && typeof v === "object" && !Array.isArray(v) && !isRows(v) && !isField(v) ? (v as Record<string, unknown>) : {}), [String(a[0] ?? "")]: a[1] ?? null }),
  get: (v, a) => (Array.isArray(v) ? (v[Number(a[0])] ?? null) : v && typeof v === "object" && !isRows(v) && !isField(v) ? ((v as Record<string, unknown>)[String(a[0])] ?? null) : null),
  at: (v, a) => itemsOf(v)[Number(a[0])] ?? null,
  keys: (v) => (v && typeof v === "object" && !Array.isArray(v) && !isRows(v) && !isField(v) ? Object.keys(v as object) : []),
  len: (v) => (typeof v === "string" ? v.length : Array.isArray(v) ? v.length : v && typeof v === "object" && !isRows(v) && !isField(v) ? Object.keys(v as object).length : isRows(v) ? v.rows.length : textOf(plain(v)).length),
  first: (v) => itemsOf(v)[0] ?? null,
  last: (v) => itemsOf(v).at(-1) ?? null,
  // 0 … n-1 (at most 10000).
  range: (v) => Array.from({ length: Math.max(0, Math.min(10000, Math.floor(numOf(plain(v)) ?? 0))) }, (_, i) => i),
  // With a function of your own (<def>): each item through it; the items it says yes to; all folded into one value.
  map: (v, a, ctx) => itemsOf(v).slice(0, 10000).map((x) => callUser(ctx, String(a[0] ?? ""), [x])),
  keep: (v, a, ctx) => remake(v, itemsOf(v).slice(0, 10000).filter((x) => truthy(callUser(ctx, String(a[0] ?? ""), [x])))),
  reduce: (v, a, ctx) => itemsOf(v).slice(0, 10000).reduce<unknown>((acc, x) => callUser(ctx, String(a[0] ?? ""), [acc, x]), a[1] ?? null),
  json: (v) => JSON.stringify(isRows(v) ? v.rows.map((r) => ({ id: r.id, title: r.title })) : isField(v) ? v.value : v),
  sum: (v, a, ctx) => sumOf(a.length ? valuesOf(v, ctx, String(a[0])) : itemsOf(v)).reduce((x, y) => x + y, 0),
  avg: (v, a, ctx) => {
    const ns = sumOf(a.length ? valuesOf(v, ctx, String(a[0])) : itemsOf(v));
    return ns.length ? ns.reduce((x, y) => x + y, 0) / ns.length : null;
  },
  min: (v, a, ctx) => {
    const ns = sumOf(a.length ? valuesOf(v, ctx, String(a[0])) : itemsOf(v));
    return ns.length ? Math.min(...ns) : null;
  },
  max: (v, a, ctx) => {
    const ns = sumOf(a.length ? valuesOf(v, ctx, String(a[0])) : itemsOf(v));
    return ns.length ? Math.max(...ns) : null;
  },
  pluck: (v, a, ctx) => valuesOf(v, ctx, String(a[0] ?? "title")).map((x) => textOf(plain(x))),
  euro: (v, a, ctx) => (numOf(plain(v)) === null ? "" : money(numOf(plain(v))!, ctx.data.locale ?? "de-DE", typeof a[0] === "number" ? a[0] : undefined)),
  number: (v, a, ctx) => (numOf(plain(v)) === null ? "" : numOf(plain(v))!.toLocaleString(ctx.data.locale ?? "de-DE", { maximumFractionDigits: typeof a[0] === "number" ? a[0] : 2 })),
};

/** The filters a view's values and collections take (the editor's completion). */
export const viewFilterNames = (): string[] => [...new Set([...Object.keys(LIST_FILTERS), ...Object.keys(CARD_FILTERS)])].sort();

function pipe(src: string, ctx: Ctx, line: number): unknown {
  let parts: string[];
  try {
    parts = splitPipes(src);
  } catch (e) {
    ctx.errors.push({ line, message: (e as Error).message });
    return null;
  }
  const [expr, ...fs] = parts;
  if (!expr) {
    ctx.errors.push({ line, message: "Nothing between {{ and }}." });
    return null;
  }
  return applyFilters(head(expr, ctx, line), fs, ctx, line);
}

type FilterCall = ReturnType<typeof parseFilter>;

/** One filter applied: Zeff's own for collections and values, the cards', or a function of the view's own (<def>) with the value as its first argument. */
function applyFilter(v: unknown, call: FilterCall, ctx: Ctx): unknown {
  const own = LIST_FILTERS[call.name];
  if (own) return own(v, argsOf(call, ctx), ctx);
  const card = CARD_FILTERS[call.name];
  if (card) return card(isRows(v) ? v.rows.length : v, argsOf(call, ctx), cardCtx(ctx));
  if (ctx.fns.has(norm(call.name))) return callUser(ctx, call.name, [v, ...argsOf(call, ctx)]);
  throw new Error(`There is no filter “${call.name}”.`);
}

/** A value through filters, in order (written as text, or already read): one that fails is said at its line and skipped. */
function applyFilters(v: unknown, filters: (string | FilterCall)[], ctx: Ctx, line: number): unknown {
  for (const f of filters) {
    try {
      v = applyFilter(v, typeof f === "string" ? parseFilter(f) : f, ctx);
    } catch (e) {
      ctx.errors.push({ line, message: (e as Error).message });
    }
  }
  return v;
}

/** A filter's arguments: the bare ones read (state.q, a field of the row or item, app.…) — words in quotes stay words. */
function argsOf(call: { args: (string | number)[]; names?: boolean[] }, ctx: Ctx): (string | number)[] {
  return call.args.map((a, i) => {
    if (!call.names?.[i] || typeof a !== "string") return a;
    // (A field's name as the first argument of where/sort/sum … is a name of a column, not a value: kept when nothing else has it.)
    const x = resolve(ctx, a.replace(/^\[|\]$/g, ""));
    if (!x.found) return a;
    const v = plain(x.value);
    return typeof v === "number" ? v : textOf(v);
  });
}

const cardCtx = (ctx: Ctx): CardCtx => ({ scope: { get: () => undefined, now: ctx.data.now ?? new Date(), names: [] }, locals: new Map(), errors: ctx.errors });
const truthy = (v: unknown): boolean => {
  const x = plain(v);
  return !(x === null || x === undefined || x === "" || x === false || x === 0 || (Array.isArray(x) && x.length === 0));
};

/** A value written out (the cards' nodes kept: a chip stays a chip). */
function out(v: unknown): VNode[] {
  if (Array.isArray(v) && v.length && v.every(isNode)) return v as VNode[];
  if (isNode(v) && typeof v !== "string") return [v];
  if (isRows(v)) return [String(v.rows.length)];
  const s = textOf(plain(v) === v ? v : isField(v) ? v : plain(v));
  return s ? [s] : [];
}

/** The attributes that are words shown to the user (translated); every other one is a name, a value or a flow — never translated. */
const WORD_ATTRS = new Set(["label", "title", "subtitle", "placeholder", "empty", "tip", "more", "confirm", "first", "begin", "done", "aside", "text", "none", "all"]);

/**
 * A run of a template's text with its values ({{ … }}, given as null) as {0}, {1} …, the spaces made one: the key the language bundles know it by —
 * "" when there are no words in it. The same when drawn and when Zeff's texts are collected (src/lib/i18n/collect.ts).
 */
export function wordsKey(parts: (string | null)[]): string {
  let i = 0;
  const key = parts.map((p) => (p === null ? `{${i++}}` : p)).join("").replace(/\s+/g, " ").trim();
  return /\p{L}{2}/u.test(key.replace(/\{\d+\}/g, "")) ? key : "";
}

/** A run in the user's language (the bundle's words, its values put back) — null: the bundle doesn't have it. */
function translated(parts: (string | null)[], tr: ((text: string) => string) | undefined, value: (i: number) => string): string | null {
  const key = tr ? wordsKey(parts) : "";
  const said = key ? tr!(key) : key;
  if (!key || said === key) return null;
  const pad = (s: string | null | undefined, re: RegExp) => (s && re.test(s) ? " " : "");
  return pad(parts[0], /^\s/) + said.replace(/\{(\d+)\}/g, (m, k: string) => value(Number(k)) ?? m) + pad(parts[parts.length - 1], /\s$/);
}

/** The sentences a template shows (its keys in the language bundles, as wordsKey makes them when it is drawn): what Zeff's texts collector keeps. */
export function templateWords(src: string): string[] {
  const found = new Set<string>();
  const keep = (key: string) => key && found.add(key);
  const attr = (v: string) => wordsKey(v.split(/(\{\{[\s\S]*?\}\})/).filter((x) => x !== "").map((x) => (x.startsWith("{{") && x.endsWith("}}") ? null : x)));
  const walk = (list: TNode[]) => {
    let run: (string | null)[] = [];
    const flush = () => (keep(wordsKey(run)), (run = []));
    for (const n of list) {
      if (n.k === "text") run.push(n.v);
      else if (n.k === "out") run.push(null);
      else {
        flush();
        if (n.k === "tag") {
          for (const [k, v] of n.attrs) {
            if (WORD_ATTRS.has(k)) keep(attr(v));
            if (k === "options" && (n.name === "select" || n.name === "tabs") && !v.includes("{{")) for (const o of optionPairs(v)) keep(wordsKey([o[1]]));
          }
          walk(n.kids);
        } else if (n.k === "if") (walk(n.then), walk(n.else));
        else walk(n.body);
      }
    }
    flush();
  };
  walk(parseView(src).nodes);
  return [...found];
}

/** A text with {{ … }} filled in; `words`: it is shown to the user (an attribute of WORD_ATTRS) — in the user's language. */
function interpolate(raw: string, ctx: Ctx, line: number, words = false): string {
  const value = (inner: string): string => {
    const v = pipe(inner.trim(), ctx, line);
    return out(v)
      .map((n) => (typeof n === "string" ? n : textOf(n.c.map((c) => (typeof c === "string" ? c : "")).join(""))))
      .join(", ");
  };
  if (words && ctx.data.tr) {
    const inners: string[] = [];
    const parts = raw.split(/(\{\{[\s\S]*?\}\})/).filter((x) => x !== "").map((x) => (x.startsWith("{{") && x.endsWith("}}") ? (inners.push(x.slice(2, -2)), null) : x));
    const said = translated(parts, ctx.data.tr, (i) => value(inners[i]));
    if (said !== null) return said;
  }
  return raw.replace(/\{\{([\s\S]*?)\}\}/g, (_m, inner: string) => value(inner));
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

/** "a:Label A, b:Label B" (or "a, b") as [value, label] pairs — "a:Label A:12": with a count shown beside the label. */
const optionPairs = (s: string): ([string, string] | [string, string, string])[] =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const i = x.indexOf(":");
      if (i < 0) return [x, x];
      const rest = x.slice(i + 1).trim();
      const n = /^(.*):\s*(\d+)$/.exec(rest);
      return n ? [x.slice(0, i).trim(), n[1].trim(), n[2]] : [x.slice(0, i).trim(), rest];
    });

/** A property's value as stored: an option's name → its id. */
function storedValue(p: Property, v: string): unknown {
  if (p.type === "select" || p.type === "status") return p.options?.find((o) => norm(o.name) === norm(v) || o.id === v)?.id ?? v;
  if (p.type === "multi_select") return v.split(",").map((x) => p.options?.find((o) => norm(o.name) === norm(x))?.id ?? x.trim());
  if (p.type === "number") return v.trim() === "" ? null : Number(v.replace(",", "."));
  if (p.type === "checkbox") return v === "true" || v === "1";
  return v;
}

/** map="Poster=poster, Year=year" as pairs: [property, field]. */
const lookupMap = (s: string): [string, string][] =>
  s.split(",").flatMap((part): [string, string][] => {
    const i = part.indexOf("=");
    return i > 0 && part.slice(i + 1).trim() ? [[part.slice(0, i).trim(), part.slice(i + 1).trim()]] : [];
  });

/**
 * A row's text with its checklist (`text`: "☐ …" / "☑ …" lines): each box becomes a <task> — the n-th task of the row's page,
 * ticked in place (the page's own checklist item). Other text stays as it is.
 */
export function taskify(nodes: VNode[], row: string, seen = { n: 0 }): VNode[] {
  return nodes.flatMap((c): VNode[] => {
    if (typeof c !== "string") return [{ ...c, c: taskify(c.c, row, seen) }];
    if (!/(^|\n)[☐☑] /.test(c)) return [c];
    const out: VNode[] = [];
    for (const [i, line] of c.split("\n").entries()) {
      if (i > 0) out.push("\n");
      const m = /^([☐☑]) (.*)$/.exec(line);
      if (!m) out.push(line);
      else out.push({ t: "task", a: { row, n: String(seen.n++), checked: String(m[1] === "☑"), label: m[2] }, c: [] }, m[2]);
    }
    return out;
  });
}

function withRow(ctx: Ctx, row: Row): Ctx {
  return { ...ctx, row, item: null, locals: new Map(ctx.locals) };
}
function withItem(ctx: Ctx, item: unknown): Ctx {
  if (item instanceof Object && "cells" in (item as object) && "id" in (item as object)) return withRow(ctx, item as Row);
  const locals = new Map(ctx.locals);
  if (!(item && typeof item === "object")) locals.set("this", { value: item, text: textOf(item), prop: null });
  return { ...ctx, row: null, item: item && typeof item === "object" ? (item as Record<string, unknown>) : null, locals };
}

function attrsOf(n: Extract<TNode, { k: "tag" }>, ctx: Ctx): Record<string, string> {
  const def = VIEW_TAGS[n.name];
  const a: Record<string, string> = {};
  for (const [k, raw] of n.attrs) {
    const kind = def.attrs[k] ?? ANY_TAG_ATTRS[k];
    if (!kind) continue;
    if (kind === "list") {
      a[k] = raw;
      continue;
    }
    const ok = checkAttr(kind, interpolate(raw, ctx, n.line, WORD_ATTRS.has(k)));
    if (ok !== null) a[k] = ok;
  }
  // In a block: each use keeps its own state (the names it gives get its prefix), and @name is one of the block's flows.
  if (ctx.prefix) {
    for (const k of STATE_KEYS[n.name] ?? []) if (a[k]) a[k] = ctx.prefix + a[k];
    if (n.name === "button" && a.then?.includes("=")) a.then = ctx.prefix + a.then.trimStart();
  }
  if (ctx.block) for (const k of ["run", "flow"]) if (a[k]?.startsWith("@")) a[k] = blockFlowName(ctx.block.name, a[k].slice(1));
  return a;
}

/** A name for a block's use: letters, digits and _ (its state's and data's prefix). */
const keyOf = (s: string) => s.replace(/[^\p{L}\p{N}_]/gu, "_");

/** The day of a value ("2026-11-03", a date's {start}, a Date): YYYY-MM-DD, or null. */
function dayOf(v: unknown): string | null {
  const x = plain(v);
  if (x instanceof Date) return localDay(x);
  if (x && typeof x === "object" && "start" in (x as object)) return dayOf((x as { start: unknown }).start);
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(textOf(x));
  return m ? m[1] : null;
}

/** A field's name in an attribute: as written ("Due", "[Due date]"), or worked out ({{ props.field }} in a block). */
const fieldName = (raw: string | undefined, ctx: Ctx, line: number): string => {
  const s = (raw ?? "").trim();
  return (s.includes("{{") ? interpolate(s, ctx, line) : s).trim().replace(/^\[|\]$/g, "");
};

/** A collection's items with a value of each — a row's field, an object's key — by a name ("" or missing: none). */
const fieldValues = (ctx: Ctx, src: unknown, field: string | undefined): unknown[] => (field ? valuesOf(src, ctx, field.trim().replace(/^\[|\]$/g, "")) : itemsOf(src).map(() => null));

/** A number as a filter writes it (format="euro", "number(1)", "hours", "percent") — plain without one. */
function formatted(ctx: Ctx, n: number, format: string | undefined, line: number): string {
  if (!format) return Number.isInteger(n) ? String(n) : n.toLocaleString(ctx.data.locale ?? "de-DE", { maximumFractionDigits: 2 });
  try {
    const call = parseFilter(format);
    const own = LIST_FILTERS[call.name];
    const card = CARD_FILTERS[call.name];
    if (!own && !card) throw new Error(`There is no filter “${call.name}”.`);
    return textOf(own ? own(n, argsOf(call, ctx), ctx) : card(n, argsOf(call, ctx), cardCtx(ctx)));
  } catch (e) {
    ctx.errors.push({ line, message: (e as Error).message });
    return String(n);
  }
}

/** <use block="…">: a block of your own drawn — its template with its parameters, its own state, what stood inside it in its slots. */
function drawUse(n: Extract<TNode, { k: "tag" }>, ctx: Ctx): VNode[] {
  const raw = Object.fromEntries(n.attrs);
  const err = (message: string) => (ctx.errors.push({ line: n.line, message }), [] as VNode[]);
  const name = (raw.block ?? "").trim().toLowerCase();
  if (!name) return err('<use> needs block="…" (the name of a block).');
  if (!ctx.blocks) return [];
  const def = ctx.blocks.get(name);
  if (!def) return err(`There is no block “${name}” — there are ${[...ctx.blocks.keys()].join(", ") || "none yet (workspace_save_block makes one)"}.`);
  if (ctx.stack.includes(name)) return err(`The block “${name}” stands in itself (${[...ctx.stack, name].join(" → ")}).`);
  if (ctx.stack.length >= MAX_BLOCK_DEPTH) return err(`Blocks stand in blocks ${MAX_BLOCK_DEPTH} deep at most.`);
  const byName = new Map(def.params.map((p) => [norm(p.name), p]));
  for (const k of Object.keys(raw)) if (k !== "block" && k !== "id" && !byName.has(norm(k))) err(`The block “${name}” has no parameter “${k}” — it takes ${def.params.map((p) => p.name).join(", ") || "none"}.`);
  const props: Record<string, unknown> = {};
  for (const p of def.params) {
    const key = Object.keys(raw).find((k) => norm(k) === norm(p.name));
    const given = key === undefined ? undefined : raw[key];
    if (given === undefined && p.required) err(`The block “${name}” needs ${p.name}="…"${p.help ? ` (${p.help})` : ""}.`);
    const text = given ?? p.default;
    if (p.type === "list") {
      // A collection, as a source= is written (rows | where(…)) — {{ }} around it are allowed.
      const expr = (text ?? "").trim().replace(/^\{\{([\s\S]*)\}\}$/, "$1").trim();
      props[p.name] = expr ? pipe(expr, ctx, n.line) : [];
    } else {
      const v = text === undefined ? "" : interpolate(text, ctx, n.line);
      if (p.options?.length && v && !p.options.some((o) => norm(o) === norm(v))) err(`${p.name}="${v}": the block “${name}” takes ${p.options.join(", ")}.`);
      props[p.name] = paramValue(p, v);
    }
  }
  // A widget block: drawn by the page in its frame; its parameters (a collection: the rows as plain objects) are what it is told.
  if (def.widget) {
    const plainProps = Object.fromEntries(
      Object.entries(props).map(([k, v]) => [
        k,
        isRows(v) || Array.isArray(v)
          ? itemsOf(v).slice(0, 500).map((it) => {
              if (it instanceof Object && "cells" in (it as object) && "id" in (it as object)) {
                const r = it as Row;
                return { id: r.id, title: r.title, ...Object.fromEntries(ctx.data.props.map((p) => [p.name, plain(fieldOf(ctx, r, p.name)?.value ?? null)])) };
              }
              return plain(it);
            })
          : plain(v),
      ]),
    );
    const params = JSON.stringify(plainProps);
    if (params.length > 400_000) return err(`The block “${name}”: its parameters are too big for a widget (${params.length} characters).`);
    const wid = raw.id?.trim() ? keyOf(interpolate(raw.id, ctx, n.line)) : `${keyOf(name)}${ctx.seq.n++}`;
    return [{ t: "appwidget", a: { block: name, id: wid, title: def.title || def.name, params, ...(def.widget.height ? { height: String(def.widget.height) } : {}) }, c: [] }];
  }
  // What stood inside: <fill slot="x"> for a named slot, the rest for <slot/>.
  const slots = new Map<string, { nodes: TNode[]; ctx: Ctx }>();
  const fills = n.kids.filter((k): k is Extract<TNode, { k: "tag" }> => k.k === "tag" && k.name === "fill");
  slots.set("", { nodes: n.kids.filter((k) => !fills.includes(k as Extract<TNode, { k: "tag" }>)), ctx });
  for (const f of fills) slots.set(norm(Object.fromEntries(f.attrs).slot ?? ""), { nodes: f.kids, ctx });
  const parsed = parseView(def.template);
  const id = raw.id?.trim() ? keyOf(interpolate(raw.id, ctx, n.line)) : `${keyOf(name)}${ctx.seq.n++}`;
  const inner: Ctx = { ...ctx, prefix: `_${id}_`, block: { name, props, slots }, stack: [...ctx.stack, name], vars: new Map(), fns: new Map(), errors: [] };
  const nodes = drawList(parsed.nodes, inner);
  // (Its mistakes said where the block is used, with its own line.)
  for (const e of [...parsed.errors, ...inner.errors]) ctx.errors.push({ line: n.line, message: e.message.startsWith("block “") ? e.message : `block “${name}”, line ${e.line}: ${e.message}` });
  // One thing where it stands (a cell of a grid, a pane): its parts together in a column — one part stays as it is.
  const parts = nodes.filter((x) => typeof x !== "string" || x.trim());
  return parts.length > 1 && parts.some((x) => typeof x !== "string") ? [{ t: "col", a: { gap: "3" }, c: nodes }] : nodes;
}

/** A month's first day ("2026-11") — the one asked for, or the one of now. */
function monthOf(asked: string | undefined, now: Date): string {
  return /^\d{4}-\d{2}$/.test(asked ?? "") ? asked! : localDay(now).slice(0, 7);
}

function drawTag(n: Extract<TNode, { k: "tag" }>, ctx: Ctx): VNode[] {
  // (A block's parameters are its own: a collection isn't interpolated as a text first.)
  if (n.name === "use") return drawUse(n, ctx);
  const a = attrsOf(n, ctx);
  const err = (message: string) => ctx.errors.push({ line: n.line, message });
  const kids = () => drawList(n.kids, ctx);
  const source = (): unknown => (a.source ? pipe(a.source, ctx, n.line) : new RowList(ctx.data.rows));
  switch (n.name) {
    case "state": {
      if (!a.name) return (err("<state> needs a name."), []);
      if (ctx.state[a.name] === undefined) ctx.state[a.name] = a.value ?? "";
      return [];
    }
    case "tabs":
    case "select": {
      if (!a.bind) return (err(`<${n.name}> needs bind="…" (the state it sets).`), []);
      // (The labels in the user's language: a label the language bundles know.)
      const opts = optionPairs(a.options ?? "").map((o) => ((ctx.data.tr ? [o[0], ctx.data.tr(o[1]), ...o.slice(2)] : o) as typeof o));
      if (!opts.length) return (err(`<${n.name}> needs options="value:Label, …".`), []);
      if (ctx.state[a.bind] === undefined) ctx.state[a.bind] = opts[0][0];
      return [{ t: n.name, a: { ...a, options: JSON.stringify(opts), current: ctx.state[a.bind] }, c: [] }];
    }
    case "ask":
    case "dossier":
      return [{ t: n.name, a, c: [] }];
    case "lookup": {
      if (!a.source) return (err('<lookup> needs source="…".'), []);
      const map = lookupMap(a.map ?? "");
      if (!map.length) return (err('<lookup> needs map="Property=field, …".'), []);
      const isTitle = (name: string) => norm(name) === "title" || norm(name) === norm(ctx.data.titleName);
      for (const name of [...map.map(([prop]) => prop), ...(a.unique ? [a.unique] : [])]) if (!isTitle(name) && !propByName(ctx, name)) return (err(`There is no property “${name}”.`), []);
      return [{ t: "lookup", a: { ...a, map: JSON.stringify(map) }, c: [] }];
    }
    case "search":
    case "toggle": {
      if (!a.bind) return (err(`<${n.name}> needs bind="…".`), []);
      return [{ t: n.name, a: { ...a, current: ctx.state[a.bind] ?? "" }, c: [] }];
    }
    case "list":
    case "cards":
    case "gallery":
    case "timeline": {
      const all = itemsOf(source());
      // page=20: that many, and a button for the next ones (where it stands is the view's state).
      const page = Number(a.page) || 0;
      const moreKey = `${ctx.prefix}more:${n.line}`;
      const count = page ? Number(ctx.state[moreKey]) || page : all.length;
      const items = all.slice(0, count).map((it, i) => {
        const c = withItem(ctx, it);
        // (An item of an app's list with an id is picked by it, as a row is.)
        const id = c.row ? String(c.row.id) : c.item && (typeof c.item.id === "number" || typeof c.item.id === "string") ? String(c.item.id) : null;
        const own: Record<string, string> = id ? { row: id } : { index: String(i) };
        if (a.image !== undefined) own.image = checkAttr("url", interpolate(a.image, c, n.line)) ?? "";
        if (a.alt !== undefined) own.alt = interpolate(a.alt, c, n.line);
        if (a.date !== undefined) own.date = interpolate(a.date, c, n.line);
        if (n.name === "timeline" && a.side !== undefined) own.side = interpolate(a.side, c, n.line);
        if (n.name === "timeline" && a.dot !== undefined) own.dot = interpolate(a.dot, c, n.line);
        return { t: "item", a: own, c: drawList(n.kids, c) } as VNode;
      });
      const more: VNode[] = count < all.length ? [{ t: "button", a: { action: "state", state: moreKey, value: String(count + page), label: a.more ?? "Show more", variant: "quiet", wide: "true" }, c: [] }] : [];
      return [{ t: n.name, a: { ...a, source: "", image: "", alt: "", date: "", side: "", dot: "", ...(ctx.prefix ? { selkey: `${ctx.prefix}selected` } : {}) }, c: items }, ...more];
    }
    case "board": {
      const p = a.group ? propByName(ctx, a.group) : undefined;
      if (!p || (p.type !== "select" && p.type !== "status")) return (err('<board> needs group="…": a select or status property.'), []);
      const src = source();
      if (!isRows(src)) return (err('<board> shows rows: source="rows | …".'), []);
      const cols = (p.options ?? []).map((o) => ({ id: o.id, name: o.name }));
      const known = new Set(cols.map((c) => c.id));
      const colOf = (r: Row) => (known.has(String(r.cells[p.id] ?? "")) ? String(r.cells[p.id]) : "");
      const items = src.rows.map((r) => ({ t: "item", a: { row: String(r.id), col: colOf(r) }, c: drawList(n.kids, withRow(ctx, r)) }) as VNode);
      return [{ t: "board", a: { prop: p.id, cols: JSON.stringify([...(src.rows.some((r) => !colOf(r)) ? [{ id: "", name: a.none ?? "—" }] : []), ...cols]) }, c: items }];
    }
    case "groups": {
      const p = a.by ? propByName(ctx, a.by) : undefined;
      if (!p) return (err(`<groups>: there is no property “${a.by ?? ""}”.`), []);
      const src = source();
      if (!isRows(src)) return (err('<groups> shows rows: source="rows | …".'), []);
      const buckets = new Map<string, Row[]>((p.options ?? []).map((o) => [o.name, []]));
      for (const r of src.rows) {
        const label = fieldOf(ctx, r, p.id)?.text || (a.none ?? "—");
        buckets.set(label, [...(buckets.get(label) ?? []), r]);
      }
      return [...buckets].flatMap(([label, rows]) => {
        if (!rows.length) return [];
        const locals = new Map(ctx.locals);
        locals.set("group", { value: label, text: label, prop: null });
        return drawList(n.kids, { ...ctx, data: { ...ctx.data, rows }, locals });
      });
    }
    case "facets": {
      if (!a.bind) return (err('<facets> needs bind="…".'), []);
      const p = a.field ? propByName(ctx, a.field) : undefined;
      if (!p) return (err(`<facets>: there is no property “${a.field ?? ""}”.`), []);
      const src = source();
      if (!isRows(src)) return (err('<facets> counts rows: source="rows | …".'), []);
      const counts = new Map<string, number>((p.options ?? []).map((o) => [o.name, 0]));
      for (const r of src.rows) {
        const label = fieldOf(ctx, r, p.id)?.text ?? "";
        if (label) counts.set(label, (counts.get(label) ?? 0) + 1);
      }
      return [{ t: "facets", a: { ...a, source: "", current: ctx.state[a.bind] ?? "", options: JSON.stringify([...counts].filter(([, c]) => c > 0).map(([label, c]) => [label, label, c])) }, c: [] }];
    }
    case "quickadd": {
      const cells: Record<string, unknown> = {};
      for (const [k, v] of optionPairs((a.values ?? "").replace(/=/g, ":"))) {
        const p = propByName(ctx, k);
        if (!p) return (err(`There is no property “${k}”.`), []);
        cells[p.id] = storedValue(p, v);
      }
      return [{ t: "quickadd", a: { ...a, values: JSON.stringify(cells) }, c: [] }];
    }
    case "form": {
      const fields = [];
      for (const name of (a.fields ?? "").split(",").map((x) => x.trim()).filter(Boolean)) {
        if (norm(name) === "title" || norm(name) === norm(ctx.data.titleName)) {
          fields.push({ id: TITLE, name: ctx.data.titleName, type: "text" });
          continue;
        }
        const p = propByName(ctx, name);
        if (!p) return (err(`<form>: there is no property “${name}”.`), []);
        fields.push({ id: p.id, name: p.name, type: p.type, ...(p.options ? { options: p.options.map((o) => ({ id: o.id, name: o.name })) } : {}) });
      }
      if (!fields.length) return (err('<form> needs fields="title, Status, …".'), []);
      return [{ t: "form", a: { ...a, fields: JSON.stringify(fields) }, c: [] }];
    }
    case "markdown":
      return markdownNodes(a.value ?? "");
    case "schedule": {
      const src = source();
      const field = (f: string | undefined) => (f ? fieldValues(ctx, src, f) : null);
      const list = itemsOf(src);
      const starts = field(a.start || "Start");
      const ends = field(a.end || "End");
      const titles = field(a.title || "title");
      const ids = field(a.id);
      const colors = field(a.color);
      const alldays = field(a.allday);
      const edits = field(a.editable);
      const at = (xs: unknown[] | null, i: number) => (xs ? textOf(plain(xs[i])).trim() : "");
      const yes = (xs: unknown[] | null, i: number) => !!xs && plain(xs[i]) !== null && !["", "false", "0", "no"].includes(at(xs, i).toLowerCase());
      // (A date field may hold a range {start, end}: its start — and its end, when there is no end field.)
      const stamp = (v: unknown, i: number, which: "start" | "end") => {
        const raw = isField(v) && v.prop?.type === "date" && isRows(src) ? src.rows[i]?.cells[v.prop.id] : plain(v);
        if (raw && typeof raw === "object" && "start" in (raw as object)) {
          const r = raw as { start?: string; end?: string };
          return String((which === "end" ? r.end : r.start) ?? r.start ?? "");
        }
        return which === "end" && isField(v) && v.prop?.type === "date" ? "" : textOf(plain(v)).trim();
      };
      const items = list.flatMap((_it, i) => {
        const start = stamp(starts?.[i], i, "start");
        if (!/^\d{4}-\d{2}-\d{2}/.test(start)) return [];
        const end = textOf(plain(ends?.[i])).trim() || stamp(starts?.[i], i, "end") || start;
        const id = at(ids, i) || (isRows(src) ? String(src.rows[i].id) : String(i));
        return [{ id, title: at(titles, i), start, end: end < start ? start : end, allDay: alldays ? yes(alldays, i) : start.length === 10, color: at(colors, i), editable: edits ? yes(edits, i) : !!a.move }];
      });
      return [{ t: "schedule", a: { items: JSON.stringify(items), view: ["day", "week", "month", "agenda"].includes(a.view ?? "") ? a.view! : "week", day: /^\d{4}-\d{2}-\d{2}$/.test(a.day ?? "") ? a.day! : "", ...Object.fromEntries((["bind", "emit", "move", "create", "daybind", "empty"] as const).filter((k) => a[k]).map((k) => [k, a[k]])), ...(a.bind ? { current: ctx.state[a.bind] ?? "" } : {}) }, c: [] }];
    }
    case "graph": {
      const src = source();
      if (a.look === "map") {
        // The dependency map: nodes with their parts, bands (groups) side by side, the red thread (src/components/skill-tree/SkillMap).
        const nodes = itemsOf(src).map((x) => plain(x));
        if (!nodes.length) return a.empty ? [a.empty] : [];
        const groups = a.groups ? itemsOf(pipe(a.groups, ctx, n.line)).map((x) => plain(x)) : [];
        const route = a.route ? plain(pipe(a.route, ctx, n.line)) : null;
        return [{ t: "graph", a: { look: "map", map: JSON.stringify({ nodes, groups, route }), label: a.label ?? "", ...(a.bind ? { bind: a.bind, current: ctx.state[a.bind] ?? "" } : {}), ...(a.emit ? { emit: a.emit } : {}), ...(a.stepbind ? { stepbind: a.stepbind } : {}), ...(a.stepemit ? { stepemit: a.stepemit } : {}) }, c: [] }];
      }
      const field = (f: string | undefined) => (f ? fieldValues(ctx, src, fieldName(f, ctx, n.line)) : null);
      const ids = (field(a.id || "title") ?? []).map((v) => textOf(plain(v)).trim());
      const labels = field(a.label);
      const reqs = field(a.requires);
      const groups = field(a.group);
      const colors = field(a.color);
      const states = field(a.state);
      const progress = field(a.progress);
      const rings = field(a.ring);
      const listOf = (v: unknown): string[] => {
        const x = plain(v);
        return (Array.isArray(x) ? x.map((y) => textOf(plain(y))) : textOf(x).split(",")).map((y) => y.trim()).filter(Boolean);
      };
      const nodes: GraphNodeIn[] = ids.flatMap((id, i): GraphNodeIn[] =>
        id
          ? [{
              id,
              label: labels ? textOf(plain(labels[i])).trim() || id : id,
              requires: reqs ? listOf(reqs[i]) : [],
              ...(groups && textOf(plain(groups[i])).trim() ? { group: textOf(plain(groups[i])).trim() } : {}),
              ...(colors && textOf(plain(colors[i])).trim() ? { color: textOf(plain(colors[i])).trim() } : {}),
              ...(states && textOf(plain(states[i])).trim() ? { state: textOf(plain(states[i])).trim().toLowerCase() } : {}),
              ...(progress && numOf(plain(progress[i])) !== null ? { progress: Math.max(0, Math.min(1, numOf(plain(progress[i]))!)) } : {}),
              ...(rings && textOf(plain(rings[i])).trim() ? { ring: textOf(plain(rings[i])).trim().slice(0, 8) } : {}),
            }]
          : [],
      );
      if (!nodes.length) return a.empty ? [a.empty] : [];
      const thread = a.thread ? itemsOf(pipe(a.thread, ctx, n.line)).map((x) => textOf(plain(x)).trim()) : [];
      const layout = layoutGraph(nodes, { thread, walked: Number(a.walked) || 0 });
      return [{ t: "graph", a: { layout: JSON.stringify(layout), ...(a.bind ? { bind: a.bind, current: ctx.state[a.bind] ?? "" } : {}), ...(a.emit ? { emit: a.emit } : {}) }, c: [] }];
    }
    case "chat": {
      if (!a.chat || !a.key) return [];
      if (a.bump && !/^[\p{L}_][\p{L}\p{N}_]*$/u.test(a.bump)) return (err('<chat bump="…">: the name of a state.'), []);
      return [{ t: "chat", a: { ...a, ...(a.bump ? { bump: ctx.prefix + a.bump } : {}) }, c: [] }];
    }
    case "subview": {
      // Its own state (a name of its own for each template), its result to the report flow; its mistakes said with the line in it.
      const src = a.template ?? "";
      if (!src.trim()) return [];
      if (src.length > MAX_VIEW_TEMPLATE) return (err("<subview>: its template is too long."), []);
      let h = 0;
      for (let i = 0; i < src.length; i++) h = (h * 31 + src.charCodeAt(i)) | 0;
      const inner = parseView(src);
      const own: Ctx = { ...ctx, prefix: `${ctx.prefix}sv${(h >>> 0).toString(36)}_`, report: { report: a.report ?? "", with: a.with ?? "", tell: a.tell ?? "", tellkey: a.tellkey ?? "", kind: a.kind ?? "", title: a.title ?? "" }, errors: [] };
      const nodes = drawList(inner.nodes, own);
      for (const e of [...inner.errors, ...own.errors]) ctx.errors.push({ line: n.line, message: `<subview> line ${e.line}: ${e.message}` });
      return [{ t: "subview", a: { title: a.title ?? "" }, c: nodes }];
    }
    case "codewidget": {
      let html = a.html ?? "";
      const libs = (a.libs ?? "").split(",").map((x) => x.trim()).filter((x) => x in WIDGET_LIBS);
      // An exercise set (spec: JSON) is made into a widget by the kit: its mistakes are said, each of them.
      if (a.spec?.trim()) {
        let spec: unknown;
        try {
          spec = JSON.parse(a.spec);
        } catch (e) {
          return (err(`<codewidget spec>: not valid JSON (${e instanceof Error ? e.message : String(e)}).`), []);
        }
        const problems = checkSpec(spec);
        if (problems.length) return (err(`<codewidget spec>: ${problems.slice(0, 4).join("; ")}.`), []);
        html = specHtml({ ...(spec as ExerciseSet), title: (spec as ExerciseSet).title ?? a.title ?? "" });
        if (/\$[^$]+\$/.test(a.spec) && !libs.includes("katex")) libs.push("katex");
      }
      if (!html.trim()) return [];
      const ok = checkWidgetHtml(html);
      if (!ok.ok) return (err(`<codewidget>: ${ok.why}.`), []);
      return [{ t: "codewidget", a: { ...a, html, spec: "", libs: libs.join(",") }, c: [] }];
    }
    case "sparkline":
    case "tile": {
      const raw = n.name === "tile" ? a.spark : a.values;
      if (raw === undefined) return [{ t: n.name, a, c: kids() }];
      const values = raw.split(",").map((x) => Number(x.trim().replace(",", ".")));
      if (values.some((x) => !Number.isFinite(x))) return (err(`<${n.name}>: a list of numbers, separated by commas.`), []);
      return [{ t: n.name, a: { ...a, ...(n.name === "tile" ? { spark: JSON.stringify(values) } : { data: JSON.stringify(values) }) }, c: kids() }];
    }
    case "table": {
      const src = source();
      if (!isRows(src)) return (err("<table> shows rows: source=\"rows | …\"."), []);
      const cols = (a.columns ? a.columns.split(",").map((x) => x.trim()).filter(Boolean) : ["title", ...ctx.data.props.map((p) => p.id)]).map((c) => {
        if (norm(c) === "title" || norm(c) === norm(ctx.data.titleName)) return "title";
        const p = propByName(ctx, c);
        if (!p) err(`<table>: there is no property “${c}”.`);
        return p?.id ?? null;
      });
      const sum = a.sum ? propByName(ctx, a.sum)?.id : undefined;
      if (a.sum && !sum) err(`<table>: there is no property “${a.sum}” to sum.`);
      return [{ t: "table", a: { columns: JSON.stringify(cols.filter(Boolean)), rows: JSON.stringify(src.rows.map((r) => r.id)), ...(sum ? { sum } : {}), ...(a.empty ? { empty: a.empty } : {}) }, c: [] }];
    }
    case "chart": {
      const src = source();
      const group = a.group ? (propByName(ctx, a.group) ?? null) : null;
      const valueProp = a.value ? (propByName(ctx, a.value) ?? null) : null;
      const calc = a.calc ?? (valueProp || (!isRows(src) && a.value) ? "sum" : "count");
      const buckets = new Map<string, { label: string; values: number[]; n: number; color?: string }>();
      for (const it of itemsOf(src)) {
        const row = isRows(src) ? (it as Row) : null;
        const gv = row ? (group ? (fieldOf(ctx, row, group.id)?.text ?? "") : "") : textOf((it as Record<string, unknown>)?.[a.group ?? ""]);
        // (An item of an app's list may bring its own colour.)
        const own = !row && typeof (it as Record<string, unknown>)?.color === "string" ? String((it as Record<string, unknown>).color) : undefined;
        for (const label of gv ? (row ? gv.split(", ") : [gv]) : ["—"]) {
          const b = buckets.get(label) ?? { label, values: [], n: 0, color: own ?? group?.options?.find((o) => o.name === label)?.color };
          b.n++;
          const x = row ? (valueProp ? numOf(fieldOf(ctx, row, valueProp.id)?.value) : null) : numOf((it as Record<string, unknown>)?.[a.value ?? ""]);
          if (x !== null) b.values.push(x);
          buckets.set(label, b);
        }
      }
      const data = [...buckets.values()].map((b) => ({ label: b.label, value: calc === "count" ? b.n : calc === "avg" ? (b.values.length ? b.values.reduce((x, y) => x + y, 0) / b.values.length : 0) : b.values.reduce((x, y) => x + y, 0), ...(b.color ? { color: b.color } : {}) }));
      return [{ t: "chart", a: { kind: a.kind ?? "bar", data: JSON.stringify(data) }, c: [] }];
    }
    case "datatable": {
      // A table of any list: its columns' templates drawn for each item, a foot under a column (drawn once).
      const cols = n.kids.filter((k): k is Extract<TNode, { k: "tag" }> => k.k === "tag" && k.name === "column");
      if (!cols.length) return (err("<datatable> needs <column label=…>…</column> inside."), []);
      const meta = cols.map((c) => {
        const ca = attrsOf(c, ctx);
        return Object.fromEntries(Object.entries({ label: ca.label ?? "", align: ca.align, foot: ca.foot, nowrap: ca.nowrap, width: ca.width }).filter((e) => e[1] !== undefined));
      });
      const rows = itemsOf(source()).map((it) => {
        const c = withItem(ctx, it);
        const id = c.row ? String(c.row.id) : c.item && (typeof c.item.id === "number" || typeof c.item.id === "string") ? String(c.item.id) : undefined;
        return { t: "tr", a: id ? { row: id } : {}, c: cols.map((col) => ({ t: "td", a: {}, c: drawList(col.kids, c) }) as VNode) } as VNode;
      });
      return [{ t: "datatable", a: { cols: JSON.stringify(meta), ...(a.empty ? { empty: a.empty } : {}) }, c: rows }];
    }
    case "nav":
      return [{ t: "nav", a: { title: a.title ?? "" }, c: kids().filter((k) => typeof k !== "string" || k.trim()) }];
    case "entry": {
      if (!a.label) return (err("<entry> needs a label."), []);
      if (a.state && a.value === undefined) return (err('<entry state="…"> needs a value="…" (what it sets).'), []);
      // What it does: opens a row (inside a row: that row), sets the view's state, or goes to an address.
      const row = a.row ?? (!a.state && !a.href && ctx.row ? String(ctx.row.id) : undefined);
      const id = a.id || (row ? `row:${row}` : a.state ? `${a.state}=${a.value}` : a.href || a.label);
      return [{ t: "entry", a: { ...a, id, ...(row ? { row } : {}) }, c: [] }];
    }
    case "selected": {
      const id = Number(ctx.state[`${ctx.prefix}selected`]);
      const row = Number.isFinite(id) ? ctx.data.rows.find((r) => r.id === id) : undefined;
      if (!row) return a.empty ? [{ t: "muted", a: {}, c: [a.empty] }] : [];
      return [{ t: "selected", a: { row: String(row.id) }, c: drawList(n.kids, withRow(ctx, row)) }];
    }
    case "on": {
      if (!a.event && !a.keys) return (err('<on> needs event="…" (the event a button sends with emit="…") or keys="…" (a key combination).'), []);
      const asButton: Extract<TNode, { k: "tag" }> = { ...n, name: "button", attrs: n.attrs.filter(([k]) => k !== "event") };
      return drawTag(asButton, ctx).map((b) => (typeof b === "string" ? b : { ...b, t: "on", a: { ...b.a, ...(a.event ? { event: a.event } : {}) } }));
    }
    case "button": {
      // Only an event sent to the <on> handlers.
      if (a.emit && !a.action && !a.run && !a.transition) return [{ t: "button", a: { ...a, action: "emit" }, c: [] }];
      // A flow run (run="name") or a lifecycle's transition (transition="name") instead of an action.
      if (a.run || a.transition) {
        if (a.action) return (err("A button runs an action, a flow (run=) or a transition (transition=) — one of them."), []);
        if (a.transition && !ctx.row && !a.row) return (err("“transition” moves a row on — put the button in a list's item, an {{#each rows}} or <selected>."), []);
        if (a.into && !/^[\p{L}_][\p{L}\p{N}_]*$/u.test(a.into)) return (err(`into="${a.into}": a name (data.${a.into} holds the output).`), []);
        const out: Record<string, string> = { ...a, action: a.run ? "run" : "transition" };
        if (ctx.row && !a.row) out.row = String(ctx.row.id);
        return [{ t: "button", a: out, c: [] }];
      }
      const action = a.action ?? "";
      if (action === "report") {
        if (!ctx.report) return (err("action=\"report\" sends a <subview>'s result — it stands inside one."), []);
        return [{ t: "button", a: { ...a, ...ctx.report }, c: [] }];
      }
      const known = ACTIONS[action];
      if (!known && !ctx.actions.has(action)) return (err(`There is no action “${action}” — there are ${[...Object.keys(ACTIONS), ...ctx.actions].join(", ")}.`), []);
      if (known?.row && !ctx.row && !a.row) return (err(`“${action}” acts on a row — put the button in a list's item, an {{#each rows}} or <selected>.`), []);
      if (action === "say" && (!a.chat || !a.key || !a.text)) return (err('“say” needs chat="plugin.chat", key="…" and text="…".'), []);
      if (action === "assistant" && !a.request) return (err('“assistant” needs request="…".'), []);
      if (action === "assistant" && ctx.row) return (err("“assistant” can't stand in a row: what a row says must not become a request."), []);
      const out: Record<string, string> = { ...a };
      if (ctx.row && !a.row) out.row = String(ctx.row.id);
      if (action === "select" && ctx.prefix) out.selkey = `${ctx.prefix}selected`;
      if (a.prop) {
        const p = propByName(ctx, a.prop);
        if (!p) return (err(`There is no property “${a.prop}”.`), []);
        out.prop = p.id;
        if (a.value !== undefined) out.value = JSON.stringify(storedValue(p, a.value)).replace(/^"|"$/g, "");
      }
      if (a.values) {
        const cells: Record<string, unknown> = {};
        for (const [k, v] of optionPairs(a.values.replace(/=/g, ":"))) {
          const p = propByName(ctx, k);
          if (!p) err(`There is no property “${k}”.`);
          else cells[p.id] = storedValue(p, v);
        }
        out.values = JSON.stringify(cells);
      }
      return [{ t: "button", a: out, c: [] }];
    }
    case "field": {
      if (!ctx.row) return (err("<field> shows a property of a row — put it in a list's item or <selected>."), []);
      const p = propByName(ctx, a.name ?? "");
      if (!p) return (err(`There is no property “${a.name ?? ""}”.`), []);
      return [{ t: "field", a: { row: String(ctx.row.id), prop: p.id }, c: [] }];
    }
    case "part": {
      if (!a.name || !ctx.parts.has(a.name)) return (err(`There is no part “${a.name ?? ""}” — this view has ${[...ctx.parts].join(", ") || "none"}.`), []);
      return [{ t: "part", a: { ...a, ...(ctx.row ? { row: String(ctx.row.id) } : {}) }, c: kids() }];
    }
    case "data":
      if (!a.name || !/^[\p{L}_][\p{L}\p{N}_]*$/u.test(a.name)) return (err('<data> needs name="…" (a name: data.<name> holds the output).'), []);
      if (!a.flow) return (err('<data> needs flow="…" (the flow whose output it loads).'), []);
      return [{ t: "data", a, c: [] }];
    case "transitions":
      if (!ctx.row) return (err("<transitions/> shows a row's lifecycle — put it in <selected> or a row's own page."), []);
      return [{ t: "transitions", a: { ...a, row: String(ctx.row.id) }, c: [] }];
    case "todomark":
      if (!ctx.row) return (err("<todomark/> marks a row — put it in a list's item, a timeline or <selected>."), []);
      return [{ t: "todomark", a: { row: String(ctx.row.id) }, c: [] }];
    case "text": {
      // In a row: its checklist's boxes tick (the page's own items).
      const c = kids();
      return [{ t: "text", a, c: ctx.row ? taskify(c, String(ctx.row.id)) : c }];
    }
    case "widget": {
      if (!a.id) return (err('<widget> needs id="…" (a widget of a plugin).'), []);
      return [{ t: "widget", a, c: [] }];
    }
    case "slot": {
      if (!ctx.block) return (err("<slot/> stands in a block's template: where what stood inside <use> goes."), []);
      const s = ctx.block.slots.get(norm(a.name ?? ""));
      return s ? drawList(s.nodes, s.ctx) : [];
    }
    case "fill":
      return (err('<fill slot="…"> stands directly inside a <use>.'), []);
    case "case":
    case "otherwise":
      return (err(`<${n.name}> stands in a <switch>.`), []);
    case "tab":
      return (err("<tab> stands in a <tabset>."), []);
    case "switch": {
      const on = norm(a.on ?? "");
      for (const k of n.kids) if (k.k === "tag" && k.name === "case" && (attrsOf(k, ctx).value ?? "").split("|").map(norm).includes(on)) return drawList(k.kids, ctx);
      const other = n.kids.find((k): k is Extract<TNode, { k: "tag" }> => k.k === "tag" && k.name === "otherwise");
      return other ? drawList(other.kids, ctx) : [];
    }
    case "tabset": {
      const bind = a.bind || `${ctx.prefix}tabset:${n.line}`;
      const tabs = n.kids.filter((k): k is Extract<TNode, { k: "tag" }> => k.k === "tag" && k.name === "tab");
      if (!tabs.length) return (err('<tabset> needs <tab id="…" label="…">…</tab> inside.'), []);
      const metas = tabs.map((tb, i) => {
        const ta = attrsOf(tb, ctx);
        const id = ta.id || ta.label || String(i + 1);
        return ta.n ? [id, ta.label || id, ta.n] : [id, ta.label || id];
      });
      if (ctx.state[bind] === undefined) ctx.state[bind] = metas[0][0];
      const i = Math.max(0, metas.findIndex((m) => m[0] === ctx.state[bind]));
      return [{ t: "tabset", a: { bind, current: metas[i][0], options: JSON.stringify(metas) }, c: drawList(tabs[i].kids, ctx) }];
    }
    case "dialog": {
      if (!a.bind) return (err('<dialog> needs bind="…" (the state that opens it: a button action="state" state="…" value="true").'), []);
      const v = ctx.state[a.bind];
      return v && v !== "false" ? [{ t: "dialog", a, c: kids() }] : [];
    }
    case "drop": {
      if (!a.bind) return (err('<drop> needs bind="…" (the state that gets the value of what was dropped).'), []);
      return [{ t: "drop", a, c: kids() }];
    }
    case "setting": {
      const name = a.name ?? "";
      if (!/^[\p{L}_][\p{L}\p{N}_]*$/u.test(name)) return (err('<setting> needs name="…" (letters, digits, _): it is read as settings.<name>.'), []);
      if (ctx.decls.some((d) => d.name === name)) return (err(`<setting name="${name}"> twice.`), []);
      if (ctx.decls.length >= MAX_SETTINGS) return (err("Too many settings."), []);
      const options = (a.options ?? "").split(",").map((o) => o.trim()).filter(Boolean);
      const type = (a.type as SettingDecl["type"]) ?? "text";
      if (type === "select" && !options.length) return (err(`<setting name="${name}" type="select"> needs options="A, B".`), []);
      ctx.decls.push({ name, label: a.label || name, type, options, default: a.default ?? "" });
      return [];
    }
    case "settings":
      return [{ t: "settings", a: { ...(a.title ? { title: a.title } : {}) }, c: [] }];
    case "theme": {
      if (a.accent && !/^#[0-9a-f]{6}$/i.test(a.accent)) return (err('<theme accent="…"> is a colour as #rrggbb (e.g. #0ea5e9).'), []);
      return [{ t: "theme", a, c: [] }];
    }
    case "upload": {
      if (!a.bind) return (err('<upload> needs bind="…" (the state the text of the file goes into).'), []);
      return [{ t: "upload", a: { ...a, name: ctx.state[`${a.bind}_name`] ?? "", max: String(Math.min(500, Math.max(1, Number(a.max) || 200))) }, c: [] }];
    }
    case "input":
    case "slider": {
      if (!a.bind) return (err(`<${n.name}> needs bind="…" (the state it sets).`), []);
      if (ctx.state[a.bind] === undefined && a.value !== undefined) ctx.state[a.bind] = a.value;
      return [{ t: n.name, a: { ...a, current: ctx.state[a.bind] ?? "" }, c: [] }];
    }
    case "calendar": {
      const field = fieldName(a.date, ctx, n.line);
      if (!field) return (err('<calendar> needs date="…" (the field that holds the day).'), []);
      const bind = a.bind || `${ctx.prefix}cal:${n.line}`;
      const now = ctx.data.now ?? new Date();
      const month = monthOf(ctx.state[bind], now);
      if (ctx.state[bind] === undefined) ctx.state[bind] = month;
      const src = source();
      const days = fieldValues(ctx, src, field);
      const items = itemsOf(src).flatMap((it, i): VNode[] => {
        const d = dayOf(days[i]);
        if (!d || d.slice(0, 7) !== month) return [];
        const c = withItem(ctx, it);
        const id = c.row ? String(c.row.id) : c.item && (typeof c.item.id === "number" || typeof c.item.id === "string") ? String(c.item.id) : null;
        return [{ t: "item", a: { day: d, ...(id ? { row: id } : {}) }, c: drawList(n.kids, c) }];
      });
      return [{ t: "calendar", a: { bind, month, today: localDay(now), ...(a.empty ? { empty: a.empty } : {}) }, c: items }];
    }
    case "heatmap": {
      const field = fieldName(a.date, ctx, n.line);
      if (!field) return (err('<heatmap> needs date="…" (the field that holds the day).'), []);
      const src = source();
      const days = fieldValues(ctx, src, field);
      const vals = a.value ? fieldValues(ctx, src, fieldName(a.value, ctx, n.line)) : null;
      const sum = new Map<string, number>();
      itemsOf(src).forEach((_, i) => {
        const d = dayOf(days[i]);
        if (d) sum.set(d, (sum.get(d) ?? 0) + (vals && a.calc !== "count" ? (numOf(plain(vals[i])) ?? 0) : 1));
      });
      const weeks = Math.max(4, Math.min(60, Number(a.weeks) || 26));
      const now = ctx.data.now ?? new Date();
      // From the Monday (weeks − 1) weeks back to today.
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - (weeks - 1) * 7);
      const out: [string, number][] = [];
      for (const d = new Date(start); localDay(d) <= localDay(now); d.setDate(d.getDate() + 1)) out.push([localDay(d), Math.round((sum.get(localDay(d)) ?? 0) * 100) / 100]);
      return [{ t: "heatmap", a: { days: JSON.stringify(out), ...(a.label ? { label: a.label } : {}), ...(a.unit ? { unit: a.unit } : {}) }, c: [] }];
    }
    case "pivot": {
      const strip = (s: string | undefined) => fieldName(s, ctx, n.line);
      const rf = strip(a.rows);
      const cf = strip(a.cols);
      const vf = strip(a.value);
      if (!rf) return (err('<pivot> needs rows="…" (the field whose values are its rows).'), []);
      const src = source();
      const items = itemsOf(src);
      const rv = fieldValues(ctx, src, rf);
      const cv = cf ? fieldValues(ctx, src, cf) : null;
      const vv = vf ? fieldValues(ctx, src, vf) : null;
      const calc = a.calc ?? (vf ? "sum" : "count");
      const labels = (f: unknown): string[] => (isField(f) ? (f.text ? f.text.split(", ") : ["—"]) : Array.isArray(f) ? (f.length ? f.map((x) => textOf(x)) : ["—"]) : [textOf(plain(f)) || "—"]);
      // (A select's or status's options give the order; else as they come.)
      const order = (field: string, seen: string[]): string[] => {
        const p = isRows(src) ? propByName(ctx, field) : undefined;
        const opts = p?.options?.map((o) => o.name) ?? [];
        return [...opts.filter((o) => seen.includes(o)), ...seen.filter((s) => !opts.includes(s))];
      };
      const cells = new Map<string, number[]>();
      const byRow = new Map<string, number[]>();
      const byCol = new Map<string, number[]>();
      const all: number[] = [];
      const rowsSeen: string[] = [];
      const colsSeen: string[] = [];
      items.forEach((_, i) => {
        const x = vv ? numOf(plain(vv[i])) : 1;
        if (x === null) return;
        for (const r of labels(rv[i])) {
          if (!rowsSeen.includes(r)) rowsSeen.push(r);
          byRow.set(r, [...(byRow.get(r) ?? []), x]);
          for (const c of cv ? labels(cv[i]) : [""]) {
            if (!colsSeen.includes(c)) colsSeen.push(c);
            cells.set(`${r}\u0000${c}`, [...(cells.get(`${r}\u0000${c}`) ?? []), x]);
          }
        }
        for (const c of cv ? labels(cv[i]) : [""]) byCol.set(c, [...(byCol.get(c) ?? []), x]);
        all.push(x);
      });
      const agg = (xs: number[] | undefined) => (!xs?.length ? null : calc === "count" ? xs.length : calc === "avg" ? xs.reduce((p, q) => p + q, 0) / xs.length : xs.reduce((p, q) => p + q, 0));
      const fmt = (x: number | null) => (x === null ? "" : formatted(ctx, x, a.format, n.line));
      const rows = order(rf, rowsSeen);
      const cols = cf ? order(cf, colsSeen) : [""];
      const data = {
        rows,
        cols: cf ? cols : [a.label ?? (calc === "count" ? "#" : "Σ")],
        cells: rows.map((r) => cols.map((c) => fmt(agg(cells.get(`${r}\u0000${c}`))))),
        rowTotals: rows.map((r) => fmt(agg(byRow.get(r)))),
        colTotals: cols.map((c) => fmt(agg(byCol.get(c)))),
        total: fmt(agg(all)),
      };
      return [{ t: "pivot", a: { data: JSON.stringify(data), total: a.total === "false" || !cf ? "false" : "true", ...(a.empty ? { empty: a.empty } : {}) }, c: [] }];
    }
    case "rating": {
      const max = String(Math.max(1, Math.min(10, Number(a.max) || 5)));
      if (!a.prop) return [{ t: "rating", a: { value: String(numOf(a.value ?? "") ?? 0), max }, c: [] }];
      if (!ctx.row) return (err("<rating prop=…> rates a row — put it in a list's item, an {{#each rows}} or <selected>."), []);
      const p = propByName(ctx, a.prop);
      if (!p || p.type !== "number") return (err(`<rating prop="${a.prop}">: a number property of the row.`), []);
      return [{ t: "rating", a: { value: String(numOf(fieldOf(ctx, ctx.row, p.id)?.value) ?? 0), max, row: String(ctx.row.id), prop: p.id }, c: [] }];
    }
    default:
      return [{ t: n.name, a, c: kids() }];
  }
}

function drawList(list: TNode[], outer: Ctx): VNode[] {
  const res: VNode[] = [];
  let ctx = outer;
  let checkedTo = 0;
  for (let at = 0; at < list.length; at++) {
    const n = list[at];
    if (n.k === "tag" && n.name === "let") {
      // A name for a value, for what comes after it here (and inside that).
      const raw = Object.fromEntries(n.attrs);
      if (!raw.name || !/^[\p{L}_][\p{L}\p{N}_]*$/u.test(raw.name)) ctx.errors.push({ line: n.line, message: '<let> needs name="…" (letters, digits, _).' });
      else if (["rows", "state", "app", "data", "db", "outputs", "now", "this", "props", "title", "id"].includes(norm(raw.name))) ctx.errors.push({ line: n.line, message: `<let name="${raw.name}">: that name is taken — pick another.` });
      else {
        const expr = (raw.value ?? "").trim().replace(/^\{\{([\s\S]*)\}\}$/, "$1").trim();
        ctx = { ...ctx, vars: new Map(ctx.vars).set(norm(raw.name), expr ? pipe(expr, ctx, n.line) : null) };
      }
      continue;
    }
    if (n.k === "tag" && n.name === "def") {
      const raw = Object.fromEntries(n.attrs);
      const params = (raw.args ?? "").split(",").map((x) => x.trim()).filter(Boolean);
      if (!raw.name || !/^[\p{L}_][\p{L}\p{N}_]*$/u.test(raw.name)) ctx.errors.push({ line: n.line, message: '<def> needs name="…" (letters, digits, _).' });
      else if (!raw.value?.trim()) ctx.errors.push({ line: n.line, message: `<def name="${raw.name}"> needs value="…" (what it gives back).` });
      else if (params.some((p) => !/^[\p{L}_][\p{L}\p{N}_]*$/u.test(p))) ctx.errors.push({ line: n.line, message: `<def name="${raw.name}" args="…">: the arguments are names, separated by commas.` });
      else if (FORMULA_FUNCTIONS.some((f) => f.toLowerCase() === norm(raw.name)) || LIST_FILTERS[norm(raw.name)] || CARD_FILTERS[norm(raw.name)]) ctx.errors.push({ line: n.line, message: `<def name="${raw.name}">: that name is one of Zeff's own functions or filters — pick another.` });
      else ctx = { ...ctx, fns: new Map(ctx.fns).set(norm(raw.name), { name: raw.name, params, body: raw.value, vars: ctx.vars, line: n.line }) };
      continue;
    }
    // A sentence in the user's language: the run of text and {{ }} up to the next tag, looked up once (its values as {0}, {1} …).
    if (ctx.data.tr && at >= checkedTo && (n.k === "text" || n.k === "out")) {
      let end = at;
      while (end < list.length && (list[end].k === "text" || list[end].k === "out")) end++;
      checkedTo = end;
      const run = list.slice(at, end) as Extract<TNode, { k: "text" | "out" }>[];
      const values = run.filter((x): x is Extract<TNode, { k: "out" }> => x.k === "out");
      const said = translated(run.map((x) => (x.k === "text" ? x.v : null)), ctx.data.tr, (i) => {
        const x = values[i];
        return out(applyFilters(head(x.expr, ctx, x.line), x.filters, ctx, x.line)).map((v) => (typeof v === "string" ? v : "")).join("");
      });
      if (said !== null) {
        res.push(said);
        at = end - 1;
        continue;
      }
    }
    if (n.k === "text") res.push(n.v);
    else if (n.k === "out") {
      const v = applyFilters(head(n.expr, ctx, n.line), n.filters, ctx, n.line);
      res.push(...out(v));
    } else if (n.k === "if") {
      const cond = splitPipes(n.cond).length > 1 ? pipe(n.cond, ctx, n.line) : evaluate(n.cond, ctx, n.line);
      res.push(...drawList(truthy(cond) ? n.then : n.else, ctx));
    } else if (n.k === "each") {
      const src = pipe(n.expr, ctx, n.line);
      for (const it of itemsOf(src)) res.push(...drawList(n.body, withItem(ctx, it)));
    } else res.push(...drawTag(n, ctx));
  }
  return res;
}

const parsedCache = new Map<string, ReturnType<typeof parseTemplate>>();
export function parseView(src: string): ReturnType<typeof parseTemplate> {
  let p = parsedCache.get(src);
  if (!p) {
    p = parseTemplate(src.slice(0, MAX_VIEW_TEMPLATE), VIEW_TAGS);
    if (parsedCache.size > 30) parsedCache.clear();
    parsedCache.set(src, p);
  }
  return p;
}

/**
 * A view drawn: its nodes, what went wrong (by line), and the state after it (the defaults its <state>, <tabs>, <select> set).
 * `parts`/`actions`: what the app adds.
 */
export function renderView(src: string, data: ViewData, opts: { parts?: PartMeta[]; actions?: ActionMeta[]; /** null: not read yet. */ blocks?: BlockDef[] | null } = {}): { nodes: VNode[]; errors: TplError[]; state: Record<string, string> } {
  const parsed = parseView(src);
  const ctx: Ctx = {
    data,
    state: { ...data.state },
    row: data.current ?? null,
    item: null,
    locals: new Map(),
    errors: [],
    parts: new Set((opts.parts ?? []).map((p) => p.name)),
    actions: new Set((opts.actions ?? []).map((a) => a.name)),
    scopes: new Map(),
    vars: new Map(),
    fns: new Map(),
    budget: { calls: 0, depth: 0 },
    decls: [],
    blocks: opts.blocks === null ? null : new Map((opts.blocks ?? []).map((b) => [b.name, b])),
    prefix: "",
    block: null,
    stack: [],
    seq: { n: 0 },
  };
  const nodes = drawList(parsed.nodes, ctx);
  // The forms (<settings/>) get what was declared, and the values now.
  const fill = (ns: VNode[]) =>
    ns.forEach((x) => {
      if (typeof x === "string") return;
      if (x.t === "settings") x.a = { ...x.a, decls: JSON.stringify(ctx.decls), values: JSON.stringify(settingsWithDefaults(ctx.decls, data.settings)) };
      fill(x.c);
    });
  fill(nodes);
  const seen = new Set<string>();
  const errors = [...parsed.errors, ...ctx.errors].filter((e) => (seen.has(`${e.line}:${e.message}`) ? false : (seen.add(`${e.line}:${e.message}`), true)));
  return { nodes, errors, state: ctx.state };
}

export type ViewNavEntry = { id: string; label: string; icon: string; n: number; group?: string; row?: number; state?: string; value?: string; href?: string };

/** The entries of a drawn view's <nav> (none: it has no sidebar). */
export function navOf(nodes: VNode[]): { title: string; entries: ViewNavEntry[] } | null {
  for (const n of nodes) {
    if (typeof n === "string") continue;
    if (n.t === "nav") {
      const entries = n.c.flatMap((e): ViewNavEntry[] => (typeof e === "string" || e.t !== "entry" ? [] : [{ id: e.a.id, label: e.a.label, icon: e.a.icon ?? "", n: Number(e.a.n) || 0, ...(e.a.group ? { group: e.a.group } : {}), ...(e.a.row ? { row: Number(e.a.row) } : {}), ...(e.a.state ? { state: e.a.state, value: e.a.value ?? "" } : {}), ...(e.a.href ? { href: e.a.href } : {}) }]));
      return { title: n.a.title ?? "", entries };
    }
    const inner = navOf(n.c);
    if (inner) return inner;
  }
  return null;
}

/** The language as the editor's help and the AI read it: tags, filters, actions, names — and this view's parts and actions. */
export function viewReference(parts: PartMeta[] = [], actions: ActionMeta[] = [], blocks: BlockDef[] = []): string {
  return [
    "VIEW TEMPLATE LANGUAGE — tags from this list only, {{ value | filter }}, {{#if …}}…{{#else}}…{{/if}}, {{#each …}}…{{/each}}, {{! a comment }}. No HTML, no script.",
    "",
    "NAMES: rows (the view's rows — a collection), a row's properties by name ([Name with spaces]) inside a row (a list's item, {{#each rows}}, <selected>), title, id, text (what the row's page says — its first lines; show it with <text pre=true>), state.<name> (the view's state), app.<path> (the app's data), db.title, now, this (the current item), outputs.<name> (what a widget published for the whole of Zeff — a number, a text, a list, a table: {{ outputs.total | euro }}, <datatable source=\"outputs.results\">; a name with spaces or dashes: outputs.monthly_total or [outputs.Monthly total]).",
    "",
    "LAYOUT: <row gap=2 align=center justify=between wrap=true fill=true>, <col gap=2 fill=true width=120> (fill: takes the room left in a row; width: a fixed width in pixels — a column that lines the rows up), <grid cols=3 gap=3 min=220>, <section title=\"…\" aside=\"… (right of the title)\" collapsible=true open=false scroll=20> (open=wide: open on a wide screen, folded on a phone; scroll: at most 20rem high), <box title=\"…\" tone=muted|good|warn|bad>, <heading level=1|2|3>, <text tone=muted pre=true> (pre: keeps the line breaks), <split ratio=1:2> or <split side=right width=352> (two children side by side — a side column of a fixed width; stacked on a phone), <hr/>, <grow/>. Any element: phone=\"hide\" (not on a phone — a second button for what the toolbar does) or phone=\"only\" (only there).",
    "TEXT: <b> <i> <small> <muted> <code> <mono> <truncate> (one line, cut) <strike> — tip=\"…\" on text, tiles, buttons, rows: a tooltip; <clamp lines=3> <chip color=…> <badge color=…> <bar value= max= fill=\"#hex\"/> <dot color=\"#hex or name\"/> <img src= h=/> <a href=…>, <printonly>…</printonly> (only on paper), <noprint>…</noprint>.",
    "FIGURES: <tile label=\"…\" value=\"{{ … }}\" sub=\"…\" tone=good|warn|bad/> — or <tile …>content under the value (text, a part)</tile>.",
    "DATA: <list source=\"rows | …\" select=true open=true spacing=roomy empty=\"…\">item template</list>, <cards source=\"…\" cols=3>item template</cards>, <table source=\"rows | …\" columns=\"title, Status, [Due]\" sum=\"Amount\" empty=\"…\"/>, <chart kind=bar|column|line|pie source=\"rows\" group=\"Status\" value=\"Amount\" calc=count|sum|avg/>, <selected empty=\"…\">template of the row picked (a list with select=true picks)</selected>, <field name=\"Status\"/> (a row's property, editable), <datatable source=\"app.list | …\" empty=\"…\"><column label=\"…\" align=right nowrap=true foot=\"{{ … }}\">cell template (the item's fields by name)</column>…</datatable> (a table of any list).",
    "FUNCTIONS: <def name=\"fact\" args=\"n\" value=\"if(n <= 1, 1, n * fact(n - 1))\"/> makes a function of your own (from there on, also inside what follows): its value is a formula, or a pipe when it has a | ({{ x | trim | upper }}). Call it in a formula — {{ fact(5) }} — or as a filter: {{ 5 | fact }} (the piped value is its first argument). It may call itself, within a budget of calls (a function that calls itself needs a case where it stops). With lists: {{ 10 | range | map('double') | keep('even') }}, {{ rows | reduce('add', 0) }}. A list or an object in the state is kept as JSON text: {{ state.todo | fromjson | push(state.new) | tojson }} (also drop(i), put(key, value), get(key), at(i), first, last, keys, len).",
    "RICH TEXT: <markdown value=\"{{ state.note }}\"/> — Markdown (# headings, **bold**, *italic*, `code`, [text](https://…), - lists, > quotes, ``` code blocks, ---) as the view's own nodes; no HTML.",
    "DRAG AND DROP: <drag value=\"{{ id }}\">what can be picked up</drag> and <drop bind=\"moved\" emit=\"moved\" label=\"Drop here\">the target</drop> — dropping puts the dragged value in state.moved and sends the event, which an <on event=\"moved\" action=\"set\" prop=\"Status\" row=\"{{ state.moved }}\" value=\"Done\"/> handles. Files can be dropped on an <upload>.",
    "SETTINGS: <setting name=\"currency\" label=\"Currency\" type=\"select\" options=\"EUR, USD\" default=\"EUR\"/> (type text | number | toggle | select; declare them at the top) and <settings/> (the form where they are edited) — saved for the app; read anywhere as {{ settings.currency }}.",
    "THEME: <theme accent=\"#0ea5e9\" radius=none|sm|md|lg font=sans|serif|mono/> — the view's accent colour, corners and font (this view only; put it anywhere, once).",
    "GRAPH: <graph source=\"data.steps.rows\" id=\"Key\" label=\"title\" requires=\"Requires\" group=\"Phase\" color=\"Path\" state=\"Status\" progress=\"Share\" ring=\"Count\" thread=\"data.thread\" walked=3 bind=\"picked\" emit=\"opened\"/> — things that depend on each other, drawn in columns (an item stands one column after everything it requires), in bands when group is a field, lines between them; state done = ticked, locked = a lock; progress 0..1 is the ring, ring the small text in it; thread is a list of ids the red thread goes through (the first `walked` stretches solid, the rest dashed, numbered). Clicking a node sets state.<bind> to its id and sends the event.",
    "SCHEDULE: <schedule source=\"rows\" start=\"Start\" end=\"End\" title=\"title\" color=\"Kind\" view=\"{{ state.view }}\" day=\"{{ state.day }}\" bind=\"picked\" emit=\"opened\" move=\"moved\" create=\"made\" daybind=\"day\"/> — things with a time as a calendar: view day | week (in hours, side by side where they overlap) | month | agenda, around day (YYYY-MM-DD; none: today). A click on one puts its id (a row's id) in state.<bind> and sends emit; dragging one (move= given, or editable=\"Field\" true) puts its new times in state.<bind>_start / _end and sends move — an <on event=\"moved\" action=\"set\" row=\"{{ state.picked }}\" prop=\"Start\" value=\"{{ state.picked_start }}\"/> keeps them; dragging on free time puts state.<bind>_start / _end / _allday and sends create; a day clicked goes into state.<daybind>. A date field that is a range (start–end) is enough on its own; a date without a time is all day.",
    "CHAT: <chat chat=\"my-plugin.lesson\" key=\"{{ state.step }}\" title=\"Lesson: …\" first=\"Let's begin.\" begin=\"Start\" placeholder=\"Your message …\" bump=\"n\"/> — the live chat of a plugin's kind (its manifest chats): the plugin's agent with its own rules and tools, one conversation per key. Starts on the first message, shows the session while it speaks, takes the next message; the conversation itself is shown by the view from the database the chat keeps it in (the state named by bump is counted up when it grew, so the data reloads).",
    "CODE WIDGET: <codewidget html=\"{{ Code }}\" (or spec=\"{{ Spec }}\": an exercise set as JSON, made into a widget by the exercise kit) libs=\"chart,katex\" title=\"…\" height=300 report=\"my.flow\" with=\"exercise={{ id }}\" fail=\"my.error-flow\"/> — a widget (HTML/JS, e.g. an exercise the AI wrote) from the data, in the sandboxed frame: no network, no access to Zeff, libraries by name (see the widget libraries). What it reports with zeff.report({ score, correct, total, note, done, answers }) runs the flow `report` with the with= values and score/correct/total/note/done/answers added; something breaking in it runs `fail` with message. With tell=\"my-plugin.lesson\" tellkey=\"{{ state.step }}\" (kind=\"Exercise\" is how the agent is told what it was) the agent of that chat hears the result (at once when it is done, else after a quiet moment) and the error. The flow's answer can carry notice=\"+3 XP\" (shown).",
    "UPLOAD: <upload bind=\"csv\" label=\"Choose a file\" accept=\".csv,.txt,.json\" max=200/> — the file the user picks is read as text (at most max KB) into state.csv, its name in state.csv_name; work on it with filters ({{ state.csv | fromjson | … }}) or hand it to a flow (with=\"text={{ state.csv }}\").",
    "EVENTS: <button label=\"Save\" run=\"my.save\" emit=\"saved\"/> sends an event after its own action (or alone: <button emit=\"saved\" label=\"…\"/>); <on event=\"saved\" action=\"state\" state=\"msg\" value=\"Saved\"/> handles it — the attributes of a button; <on keys=\"mod+s\" run=\"my.save\"/> handles a key (mod = Ctrl / ⌘; also on a button: keys=\"mod+k\"). Handlers may send events themselves (at most 8 deep).",
    "STATE: <state name=\"dir\" value=\"owe\"/> (a default), <tabs bind=\"dir\" options=\"owe:Label, owed:Label:3\"/> (:3 — a count beside the label), <select bind=… options=… label=…/>, <search bind=\"q\" placeholder=…/> (use it: rows | search(state.q)), <toggle bind=\"done\" label=…/> (state.done is \"true\"/\"\").",
    "PANES: <panes><pane title=\"…\" aside=\"3\" width=300>…</pane><pane title=\"…\" flush=true><ask/></pane><pane title=\"…\" width=360>…</pane></panes> — an app's screen: columns as high as the window, each scrolling by itself, one under the other on a phone. width: pixels, without it a column takes the room left. flush: no padding, for what fills its pane (<ask>).",
    "PAGE: <header title=\"…\" subtitle=\"…\" icon=\"📓\">buttons on its right</header> (a view's top, instead of <heading>), <toolbar>search, filters, buttons</toolbar> (a line with a rule under it), <menu label=\"⋯\" tip=\"…\">toggles, buttons</menu> (what is used now and then, behind one button: a dropdown),<cover src= h=200 title= subtitle=/> (a wide picture), <callout tone=info|good|warn|bad title=\"…\" icon=\"…\">text</callout>, <empty icon=\"📭\" title=\"…\" text=\"…\">a button</empty> (nothing here yet: what to do), <kv min=200><pair label=\"…\">value</pair>…</kv> (facts, label over value), <steps><step title=\"…\" state=done|active|todo>text</step>…</steps>, <quote cite=\"…\">text</quote>, <divider label=\"…\"/>, <avatar src= name=\"…\" size=32/> (initials without a picture), <logo name=\"{{ Channel }}\" size=sm|lg/> (a channel's mark: Gmail, Outlook, Teams, WhatsApp, Signal, E-Mail; in <tabs> a label \"logo-gmail Gmail\" shows the mark alone), <todomark/> (in a row: a dot when it flowed into a todo, a badge ☑ n for several), <progress value= max= label=\"…\" tone= show=true/> (show: the percent), <sparkline values=\"1,4,2\" wide=true/>. <tile> also takes icon=\"📈\" trend=\"+12 %\" spark=\"1,4,2\"; <button> also icon=\"➕\".",
    "COLLECTIONS: <gallery source=\"rows\" image=\"{{ Poster }}\" alt=\"{{ title }}\" ratio=2:3|1:1|16:9|3:2 min=150 empty=\"…\">caption</gallery> (a click opens the row), <timeline source=\"rows | sort('Date', 'desc')\" date=\"{{ Date | date }}\" empty=\"…\">item</timeline>, <board source=\"rows\" group=\"Status\" none=\"…\">card</board> (columns by a select or status; a dragged card takes the column's value), <groups source=\"rows\" by=\"Status\"><section title=\"{{ group }}\" aside=\"{{ rows | count }}\"><list source=\"rows\">…</list></section></groups> (what is inside repeats per value: rows is that group's, group its name). page=20 more=\"Show more\" on list, cards, gallery, timeline: that many, and a button for the next.",
    "ENTRY: <facets bind=\"s\" field=\"Status\" all=\"All\"/> (filter pills with counts; narrow with rows | only('Status', state.s)), <quickadd placeholder=\"…\" values=\"Status=Open\"/> (a line: Enter adds a row by its title), <form fields=\"title, Status, Due\" title=\"…\" label=\"Add\" done=\"…\"/> (several fields at once).",
    "LOOKUP: <lookup source=\"tmdb.movies\" placeholder=\"…\" map=\"Poster=poster, Year=year, title=title\" unique=\"TMDB ID\" open=false language=\"de-DE\"/> — a field that searches elsewhere with suggestions; the one picked becomes a row, its fields into the properties of map (Property=field; the properties must exist; title: the row's title, by default its title). unique: a property that tells it is there already, so it isn't added twice. open=true: opens the row. The sources are listed with the language for the AI, and under Settings → Lookups.",
    "KNOWLEDGE: a database's rows as sources — <ask placeholder=\"…\" intro=\"…\" suggest=\"A question|Another\"/>: a conversation answered only from the rows, each statement naming its row, the field at its bottom; plain=true on <dossier>: without a frame, in a pane; <dossier focus=\"what matters\" empty=\"…\"/>: what the rows say together, compiled by the AI with a button, only what changed costs anything. Together with <lookup>, a list and a <text> of sources they make a notebook.",
    `BUTTONS: <button action=… label=\"…\" row=\"{{ id }}\" (the row it acts on, outside a row) variant=primary|plain|quiet|danger|link confirm=\"…\" print=true (also on paper) disabled=\"{{ … }}\" wide=true keys=\"N\" (its key, shown in the tooltip)/> — actions: ${Object.entries(ACTIONS)
      .map(([k, v]) => `${k} (${v.what}${v.row ? "; in a row" : ""})`)
      .join(", ")}${actions.length ? `, ${actions.map((x) => `${x.name} (${x.description})`).join(", ")}` : ""}.`,
    'FLOWS (what the app does on the server — a web request, a lookup, the AI, rows written; built in the Studio or with workspace_save_flow): <button run="flow.name" with="q={{ state.q }}, n=5" into="result" done="Saved." then="state=value" label="…"/> runs a flow (in a row: the row is its `row`), its output in data.result; <data name="films" flow="movie.search" with="query={{ state.q }}" when="{{ state.q }}" debounce=400/> loads a flow\'s output into data.films, again whenever with= changes (when=: only while it is filled) — data.films_status is loading|stale|ok|error (stale: the last answer, kept in the browser, shown while it loads again), data.films_error the error. Show it: {{#each data.films.hits}}…{{/each}}, <datatable source="data.films.hits">. LAMBDAS: <data name="agenda" lambda="agenda.data" with="db={{ db.id }}"/> loads the answer of a lambda the same way (a function lambda of a plugin or of the Studio; it only reads), into data.agenda. LIFECYCLE (a database whose status follows transitions): <button transition="Approve" label="…" note=true/> in a row moves it on (its guard and required fields checked on the server), <transitions history=true/> in <selected>: the row\'s transitions as buttons and its way so far.',
    "FILTERS for collections: where(\"Field\", \"value\") or where(\"Field\", \">\", 5) (=, !=, >, <, >=, <=, contains, empty, filled), only(\"Field\", state.s) (where, or all while nothing is picked), sort(\"Field\", \"desc\"), limit(5), search(state.q), count, sum(\"Field\"), avg(\"Field\"), min(\"Field\"), max(\"Field\"), pluck(\"Field\").",
    "FILTERS for values: host (an address's site), euro (euro(0): whole euros), number(2), percent, hours, date, relative, chip, upper, lower, truncate(40), clamp(3), default(\"—\"), join(\", \"), first, last, count, check, bold, muted, small, code, link, img(80), bar(max), initials.",
    "NAV: <nav title=\"…\"><entry label=\"…\" icon=\"📥\" state=\"scope\" value=\"inbox\" n=\"{{ … }}\" group=\"…\"/>…</nav> — the view's sidebar (beside the view, or — its setting — in the Workspace tree under the database); an entry sets the view's state, opens a row (row=\"{{ id }}\" — in {{#each}} the row by itself) or goes to an address (href). E.g. the newest five: {{#each rows | sort('Date', 'desc') | limit(5)}}<entry label=\"{{ title }}\" group=\"Newest\"/>{{/each}}.",
    "WIDGETS: <widget id=\"plugin.widget\" setting=value/> — a plugin's widget (as on pages).",
    "NAMES OF YOUR OWN: <let name=\"open\" value=\"rows | where('Status', '!=', 'Done')\"/> — a value named for what follows it (siblings after it and what is inside them): {{ open | count }}, <list source=\"open | limit(5)\">. <switch on=\"{{ Status }}\"><case value=\"Done|Closed\">…</case><otherwise>…</otherwise></switch>.",
    "MORE BLOCKS: <tabset bind=\"t\"><tab id=\"open\" label=\"Open\" n=\"{{ open | count }}\">content</tab><tab id=\"all\" label=\"All\">…</tab></tabset> (tabs with their content; only the one shown is drawn). <dialog bind=\"edit\" title=\"…\" side=center|right wide=true>…</dialog> (open while state.edit is filled: <button action=\"state\" state=\"edit\" value=\"true\" label=\"…\"/>; its ✕ empties it; side=right: a drawer). <input bind=\"n\" type=text|number|date|time|month|color|textarea|email|url label=\"…\" placeholder=\"…\" value=\"start\"/> and <slider bind=\"x\" min=0 max=100 step=5 label=\"…\" unit=\"%\" value=\"50\"/> (state you type or drag: {{ state.n }}, rows | where('Amount', '>', state.x)). <calendar source=\"rows\" date=\"Due\" empty=\"…\">item</calendar> (a month: the items on their days, ‹ › to page months — bind=\"m\" holds the month as 2026-11). <heatmap source=\"rows\" date=\"Date\" value=\"Hours\" calc=count|sum weeks=26 label=\"…\" unit=\"h\"/> (a day by day grid, darker where more happened). <pivot source=\"rows\" rows=\"Owner\" cols=\"Status\" value=\"Amount\" calc=count|sum|avg format=\"euro(0)\" total=true/> (a cross table with totals; format: a value filter). <gauge value=\"{{ … }}\" max=100 label=\"…\" sub=\"…\" tone=good|warn|bad size=96/> (a ring). <rating value=\"{{ … }}\" max=5/> (stars) — in a row <rating prop=\"Stars\"/> sets a number property by a click. <copy text=\"{{ URL }}\" label=\"Copy\"/> (to the clipboard).",
    "MORE FILTERS: groupby('Status') → items {group, count, items} ({{#each rows | groupby('Owner')}}<section title=\"{{ group }}\" aside=\"{{ count }}\"><list source=\"this.items\">…</list></section>{{/each}}; groupby('Owner', '—', 'count') biggest first), distinct('Tag') (each value once), offset(10), reverse, between('Due', now, '2026-12-31'), where('Status', 'in', 'Open|Waiting'), json (to look at a value).",
    blocks.length
      ? `BLOCKS of your own (use them; workspace_save_block makes more): ${blocks.map((b) => `${blockSignature(b)} — ${b.description || b.title || b.name}${b.params.some((p) => p.help) ? ` (${b.params.filter((p) => p.help).map((p) => `${p.name}: ${p.help}`).join("; ")})` : ""}`).join("; ")}. What stands inside <use>…</use> goes where its <slot/> is.`
      : "BLOCKS of your own: none yet — something used again and again (a card of a deal, a filter bar, a finder that calls a web service) can become one: workspace_block_docs tells how.",
    parts.length ? `PARTS of this app (its own blocks; <part name=…>template content</part> where a part shows content): ${parts.map((p) => `<part name="${p.name}"${Object.entries(p.attrs ?? {}).map(([k, v]) => ` ${k}="${v}"`).join("")}/> — ${p.description}`).join("; ")}.` : "PARTS: none (a view of any table: build it from the tags above).",
    "",
    "Expressions: app.owe ? 'A' : 'B', a == 3, a > b and not c — texts in '…' inside an attribute.",
    "",
    "EXAMPLE:",
    '<state name="q" value=""/>',
    '<row><heading level=2>{{ db.title }}</heading><grow/><search bind="q"/><button action="new" label="New" variant=primary/></row>',
    '<grid cols=3><tile label="Open" value="{{ rows | where(\'Status\', \'!=\', \'Done\') | count }}"/><tile label="Sum" value="{{ rows | sum(\'Amount\') | euro }}"/></grid>',
    '<split ratio=1:2><list source="rows | search(state.q) | sort(\'Due\')" select=true><row><b>{{ title }}</b><grow/>{{ Status | chip }}</row></list><selected empty="Pick a row"><heading level=3>{{ title }}</heading><field name="Status"/><button action="open" label="Open"/></selected></split>',
    "",
    "DESIGN — first decide what kind of app this is; it sets the layout. WORKSPACE (you work in it for a while: a notebook, an inbox, research, a reader): <panes> filling the screen, side by side, everything at once; no tabs, no tiles. CATALOGUE (things you look at: films, books, recipes): a <toolbar> and a <gallery>. PIPELINE (things move through stages): a <board>, or <groups> by the stage. TRACKER (a list you keep up: tasks, contacts, doses): a list with <selected> beside it. DASHBOARD (only if you came for the numbers: money, hours): tiles and charts. What you do most is on the first screen without a click: never hide a main function behind <tabs> or a button; tabs are for views of the same thing. A number earns a <tile> only if you would act on it: a count of rows is no figure, it goes into the header's subtitle or a pane's aside. One line of controls: search, filters and add belong together in one <toolbar> or pane head, never stacked in rows of inputs. A <header> with the name and at most one line that says something the name doesn't; the main action on the right, the only primary button; inside <panes> usually no header at all, the page already has the title. Density like a good tool, not like a form: a row of a list is a title and one quiet line ({{ URL | host }}, a date, a <clamp>), the status as a chip only if it varies. A title with something beside it: <row wrap=false><col fill=true><truncate>…</truncate></col>…</row>, or it breaks into two lines. Details beside a list, not under it. A pane with one job: no <selected> and <dossier> stacked in one pane with a <divider> between them; no line that only says what to click (leave <selected empty=\"\"> blank if something else is shown). Always an <empty> that says how to get out of it. No box in a box, no box around what stands alone, no decoration, no emoji in every label (one icon on the header is enough), at most one or two colours that mean something. Values as they are meant: {{ x | euro }}, {{ d | date }}, {{ Status | chip }}. Labels short, in the user's language, no explaining text on the page: a good tool needs none. Long collections: page=.",
    "",
    "FULL EXAMPLE:",
    '<state name="q" value=""/><state name="s" value=""/>',
    '<header title="{{ db.title }}" subtitle="{{ rows | count }} entries" icon="📌"><button action="new" label="New" icon="➕" variant=primary/></header>',
    '<grid cols=3 min=160><tile label="Open" value="{{ rows | where(\'Status\', \'!=\', \'Done\') | count }}" icon="📬"/><tile label="Done" value="{{ rows | where(\'Status\', \'Done\') | count }}" tone=good/><tile label="All" value="{{ rows | count }}"/></grid>',
    '<toolbar><search bind="q" placeholder="Search"/><grow/></toolbar>',
    '<split side=right width=352><list source="rows | search(state.q)" select=true page=20 empty="Nothing yet: add the first entry."><row><b>{{ title }}</b><grow/></row></list><selected empty="Pick an entry"><header title="{{ title }}"><button action="open" label="Open"/></header></selected></split>',
  ].join("\n");
}

/** How a block of your own is made — what the AI reads before workspace_save_block. */
export function blockReference(blocks: BlockDef[] = []): string {
  return [
    "BLOCKS OF YOUR OWN — a building block of the view language made from the view language: parameters, a template, and flows for what it does on the server. Every view can use it: <use block=\"name\" param=\"…\"/>. A page can show it too, with no database around it: a line `:::use name {\"param\":\"value\"}` in the page's Markdown (workspace_write_page) — there it has no rows (rows is empty); it reads what it shows through flows (<data flow=…>). A dashboard, a finder, a summary on a page: a block, not a database view — a dashboard best as several small blocks (a figure tile with a parameter for which figure, a chart, a list) laid out in rows on the page, each moved, set and changed on its own: blocks that read the same flow with the same with= ask it once.",
    "",
    "WHAT A BLOCK IS (workspace_save_block): name (lowercase, digits, - _, parts joined by dots: \"crm.deal-card\"), title, description (one line: what it shows or does — the views' authors pick by it), icon (one emoji), params [{ name, type: text|number|boolean|list|color|url, required, default, help, options: [allowed values] }], template, example (a <use …/> line), flows (optional: what it does on the server).",
    "",
    "IN ITS TEMPLATE — the whole view language (workspace_view_template_docs), and:",
    "- props.<param>: a parameter's value. A list parameter is a collection, given as a source is written (items=\"rows | where('Status', 'Open')\") — <list source=\"props.items\">, {{ props.items | count }}. A text names a field as well: where(props.field, 'Done'), <calendar date=\"{{ props.field }}\">, {{#each props.items}}…{{/each}}.",
    "- rows: the rows of the view it stands in; used inside a row (a list's item, <selected>) the row's fields are names and its buttons act on that row — a block can be a row's card.",
    "- state of its own: every use keeps its own (<state>, bind=, a button's state= and into=, <data name>, the row picked) — two uses of the same block on one view don't touch each other. {{ state.x }} reads its own.",
    "- <slot/>: what stood inside <use>…</use> goes there (drawn where the block is used, with its names). Named: <slot name=\"actions\"/> ← <use …><fill slot=\"actions\"><button …/></fill></use>.",
    "- its own flows: run=\"@search\" (a button) and <data name=\"hits\" flow=\"@search\" with=\"q={{ state.q }}\"/> call the block's flow \"search\" (saved as block.<name>.search). Any other flow by its full name.",
    "- blocks in blocks: <use> inside a block's template (not itself).",
    "",
    "FLOWS (the server side; workspace_flow_docs tells the nodes and actions): flows: [{ name: \"search\", title, inputs: [{ name: \"q\", type: \"text\" }], nodes: [...], output: \"{{ steps.x.output }}\", permissions: { … } }] — saved with the block. Permissions are only asked for: the user grants them in the Studio (the flow's page); until then a node that needs one fails and says what is missing.",
    "",
    "WIDGET BLOCKS: instead of a template a block can be a widget — `widget`: { html, libs?, writes?, ai?, flows?, height? } (the code of a widget as on pages: HTML + script in a sandbox, libraries like three, plotly, mathjs; workspace_widget docs). Its parameters arrive as zeff.context.params (a list parameter: the rows as plain objects { id, title, <field>: value }); the user allows what it writes once. Use it like any block: <use block=\"calc.sum\" values=\"rows\" label=\"Total\"/>. A widget on a page can be saved as one (🧩 in its toolbar), and the Studio's Blocks screen lists, edits and versions them all.",
    "",
    "GOOD BLOCKS: one job, named for it; generic — fields and collections come in as parameters, not written into the template (unless it is made for one database); defaults for what is optional; an <empty> when there is nothing; no help text on the page. Check it: workspace_save_block draws it and names every mistake by line; try it with workspace_update_database (a view's template using it).",
    "",
    "EXAMPLE — a card of a deal, used in a list's item:",
    '{ "name": "crm.deal-card", "description": "A deal: its title, amount, stage and owner, a button to move it on", "params": [{ "name": "amount", "type": "text", "default": "Amount" }, { "name": "stage", "type": "text", "default": "Stage" }], "template": "<row wrap=false><col fill=true><b>{{ title }}</b><small>{{ [Owner] }}</small></col>{{ props.stage | field | chip }}<b>{{ props.amount | field | euro(0) }}</b></row><slot/>", "example": "<list source=\\"rows\\"><use block=\\"crm.deal-card\\"><button action=\\"open\\" label=\\"Open\\"/></use></list>" }',
    "",
    "EXAMPLE — a finder that calls a web service (its flow) and adds what you pick:",
    '{ "name": "web.finder", "params": [{ "name": "placeholder", "type": "text", "default": "Search" }], "template": "<state name=\\"q\\" value=\\"\\"/><search bind=\\"q\\" placeholder=\\"{{ props.placeholder }}\\"/><data name=\\"hits\\" flow=\\"@search\\" with=\\"q={{ state.q }}\\" when=\\"{{ state.q }}\\" debounce=400/>{{#if data.hits_status == \'loading\'}}<muted>…</muted>{{/if}}<datatable source=\\"data.hits.items\\" empty=\\"Nothing found\\"><column label=\\"Title\\">{{ title }}</column><column label=\\"\\" align=right><button action=\\"new\\" values=\\"Name={{ title }}\\" label=\\"Add\\"/></column></datatable>", "flows": [{ "name": "search", "inputs": [{ "name": "q", "type": "text" }], "nodes": [{ "id": "get", "kind": "action", "action": "http.request", "input": { "url": "https://api.example.org/search", "query": { "q": "{{ input.q }}" } } }], "output": { "items": "{{ steps.get.json.results }}" }, "permissions": { "web": ["api.example.org"] } }] }',
    "- a field named by a parameter: {{ props.stage | field }} (the value of the row's field whose name props.stage holds — then | chip, | euro as any field).",
    "",
    blocks.length ? `THE BLOCKS THERE ARE: ${blocks.map((b) => `${blockSignature(b)} — ${b.description || b.title || b.name}`).join("; ")}.` : "THE BLOCKS THERE ARE: none yet.",
  ].join("\n");
}

/** The state a template starts with — its <state> values, the first option of its <tabs> and <select> — read before it is drawn (an app loads by it). */
export function viewDefaults(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (nodes: TNode[]) => {
    for (const n of nodes) {
      if (n.k === "tag") {
        const a = Object.fromEntries(n.attrs);
        if (n.name === "state" && a.name && !(a.name in out) && !a.value?.includes("{{")) out[a.name] = a.value ?? "";
        // (Options worked out of the data aren't known before it is drawn: the start is the <state>'s, or the first one when drawn.)
        if ((n.name === "tabs" || n.name === "select") && a.bind && !(a.bind in out) && !a.options?.includes("{{")) {
          const first = optionPairs(a.options ?? "")[0];
          if (first) out[a.bind] = first[0];
        }
        walk(n.kids);
      } else if (n.k === "if") {
        walk(n.then);
        walk(n.else);
      }
      else if (n.k === "each") walk(n.body);
    }
  };
  walk(parseView(src).nodes);
  return out;
}
