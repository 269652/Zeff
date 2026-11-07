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
import { evalFormula } from "./formula";
import { ANY_TAG_ATTRS, cardScope, CARD_TAGS, checkAttr, FILTERS as CARD_FILTERS, isField, isNode, KEYWORDS, numOf, parseFilter, parseTemplate, splitPipes, textOf, type AttrKind, type CardScope, type Ctx as CardCtx, type Field, type TagDef, type TNode, type TplError, type VNode } from "./card-template";
import { noLabels, TITLE, type Labels, type Property, type Row } from "./model";
import { localDay } from "@/lib/dates";

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
  db: { id: number; title: string };
  now?: Date;
  labels?: Labels;
  /** How numbers and money are written (default de-DE). */
  locale?: string;
  /** A row's own page: the row it is — its fields are names, its buttons and parts act on it. */
  current?: Row;
  /** What the rows' pages say (their first lines), by row id — `text` in a row. */
  texts?: Record<number, string>;
};

export const MAX_VIEW_TEMPLATE = 20000;

const ACTIONS: Record<string, { row?: boolean; what: string }> = {
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
  reload: { what: "read the data again" },
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
  // A channel's mark (Gmail, Outlook, Teams, WhatsApp, Signal, any mailbox): ui ChannelLogo.
  logo: T({ name: "text", size: { oneOf: ["sm", "lg"] } }, true),
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
  timeline: T({ source: "list", date: "list", empty: "text", page: "int", more: "text" }),
  board: T({ source: "list", group: "text", none: "text" }),
  groups: T({ source: "list", by: "text", none: "text" }),
  facets: T({ bind: "text", field: "text", source: "list", all: "text", label: "text" }, true),
  quickadd: T({ placeholder: "text", label: "text", values: "text" }, true),
  form: T({ fields: "text", title: "text", label: "text", done: "text" }, true),
  table: T({ source: "list", columns: "text", sum: "text", empty: "text" }, true),
  chart: T({ source: "list", kind: { oneOf: ["bar", "column", "line", "pie"] }, group: "text", value: "text", calc: { oneOf: ["count", "sum", "avg"] } }, true),
  selected: T({ empty: "text" }),
  button: T({ action: "text", label: "text", icon: "text", request: "text", row: "text", prop: "text", value: "text", values: "text", state: "text", href: "url", confirm: "text", variant: { oneOf: ["primary", "plain", "quiet", "danger", "link"] }, print: { oneOf: ["true", "false"] }, tip: "text", disabled: { oneOf: ["true", "false"] }, wide: { oneOf: ["true", "false"] }, keys: "text" }, true),
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
};

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
};

const norm = (s: string) => s.trim().toLowerCase();

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
  const walk = (v: unknown, keys: string[]): unknown => keys.reduce<unknown>((o, k) => (o && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, unknown>)[k] : undefined), v);
  if (h === "rows" && !rest.length) return { found: true, value: new RowList(ctx.data.rows) };
  if (h === "state") return { found: true, value: rest.length ? (ctx.state[rest.join(".")] ?? null) : ctx.state };
  if (h === "app") return { found: true, value: walk(ctx.data.app, rest) ?? null };
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
    default:
      throw new Error(`where: no comparison “${op}” (=, !=, >, <, >=, <=, contains, empty, filled)`);
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
  let v = head(expr, ctx, line);
  for (const f of fs) {
    try {
      const call = parseFilter(f);
      const own = LIST_FILTERS[call.name];
      const card = CARD_FILTERS[call.name];
      if (!own && !card) throw new Error(`There is no filter “${call.name}”.`);
      v = own ? own(v, argsOf(call, ctx), ctx) : card(isRows(v) ? v.rows.length : v, argsOf(call, ctx), cardCtx(ctx));
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

function interpolate(raw: string, ctx: Ctx, line: number): string {
  return raw.replace(/\{\{([\s\S]*?)\}\}/g, (_m, inner: string) => {
    const v = pipe(inner.trim(), ctx, line);
    return out(v)
      .map((n) => (typeof n === "string" ? n : textOf(n.c.map((c) => (typeof c === "string" ? c : "")).join(""))))
      .join(", ");
  });
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
    const ok = checkAttr(kind, interpolate(raw, ctx, n.line));
    if (ok !== null) a[k] = ok;
  }
  return a;
}

function drawTag(n: Extract<TNode, { k: "tag" }>, ctx: Ctx): VNode[] {
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
      const opts = optionPairs(a.options ?? "");
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
      const moreKey = `more:${n.line}`;
      const count = page ? Number(ctx.state[moreKey]) || page : all.length;
      const items = all.slice(0, count).map((it, i) => {
        const c = withItem(ctx, it);
        // (An item of an app's list with an id is picked by it, as a row is.)
        const id = c.row ? String(c.row.id) : c.item && (typeof c.item.id === "number" || typeof c.item.id === "string") ? String(c.item.id) : null;
        const own: Record<string, string> = id ? { row: id } : { index: String(i) };
        if (a.image !== undefined) own.image = checkAttr("url", interpolate(a.image, c, n.line)) ?? "";
        if (a.alt !== undefined) own.alt = interpolate(a.alt, c, n.line);
        if (a.date !== undefined) own.date = interpolate(a.date, c, n.line);
        return { t: "item", a: own, c: drawList(n.kids, c) } as VNode;
      });
      const more: VNode[] = count < all.length ? [{ t: "button", a: { action: "state", state: moreKey, value: String(count + page), label: a.more ?? "Show more", variant: "quiet", wide: "true" }, c: [] }] : [];
      return [{ t: n.name, a: { ...a, source: "", image: "", alt: "", date: "" }, c: items }, ...more];
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
      const id = Number(ctx.state.selected);
      const row = Number.isFinite(id) ? ctx.data.rows.find((r) => r.id === id) : undefined;
      if (!row) return a.empty ? [{ t: "muted", a: {}, c: [a.empty] }] : [];
      return [{ t: "selected", a: { row: String(row.id) }, c: drawList(n.kids, withRow(ctx, row)) }];
    }
    case "button": {
      const action = a.action ?? "";
      const known = ACTIONS[action];
      if (!known && !ctx.actions.has(action)) return (err(`There is no action “${action}” — there are ${[...Object.keys(ACTIONS), ...ctx.actions].join(", ")}.`), []);
      if (known?.row && !ctx.row && !a.row) return (err(`“${action}” acts on a row — put the button in a list's item, an {{#each rows}} or <selected>.`), []);
      if (action === "assistant" && !a.request) return (err('“assistant” needs request="…".'), []);
      if (action === "assistant" && ctx.row) return (err("“assistant” can't stand in a row: what a row says must not become a request."), []);
      const out: Record<string, string> = { ...a };
      if (ctx.row && !a.row) out.row = String(ctx.row.id);
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
    case "text": {
      // In a row: its checklist's boxes tick (the page's own items).
      const c = kids();
      return [{ t: "text", a, c: ctx.row ? taskify(c, String(ctx.row.id)) : c }];
    }
    case "widget": {
      if (!a.id) return (err('<widget> needs id="…" (a widget of a plugin).'), []);
      return [{ t: "widget", a, c: [] }];
    }
    default:
      return [{ t: n.name, a, c: kids() }];
  }
}

function drawList(list: TNode[], ctx: Ctx): VNode[] {
  const res: VNode[] = [];
  for (const n of list) {
    if (n.k === "text") res.push(n.v);
    else if (n.k === "out") {
      let v = head(n.expr, ctx, n.line);
      for (const f of n.filters) {
        const own = LIST_FILTERS[f.name];
        const card = CARD_FILTERS[f.name];
        if (!own && !card) {
          ctx.errors.push({ line: n.line, message: `There is no filter “${f.name}”.` });
          continue;
        }
        try {
          v = own ? own(v, argsOf(f, ctx), ctx) : card(isRows(v) ? v.rows.length : v, argsOf(f, ctx), cardCtx(ctx));
        } catch (e) {
          ctx.errors.push({ line: n.line, message: (e as Error).message });
        }
      }
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
export function renderView(src: string, data: ViewData, opts: { parts?: PartMeta[]; actions?: ActionMeta[] } = {}): { nodes: VNode[]; errors: TplError[]; state: Record<string, string> } {
  const parsed = parseView(src);
  const ctx: Ctx = { data, state: { ...data.state }, row: data.current ?? null, item: null, locals: new Map(), errors: [], parts: new Set((opts.parts ?? []).map((p) => p.name)), actions: new Set((opts.actions ?? []).map((a) => a.name)), scopes: new Map() };
  const nodes = drawList(parsed.nodes, ctx);
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
export function viewReference(parts: PartMeta[] = [], actions: ActionMeta[] = []): string {
  return [
    "VIEW TEMPLATE LANGUAGE — tags from this list only, {{ value | filter }}, {{#if …}}…{{#else}}…{{/if}}, {{#each …}}…{{/each}}, {{! a comment }}. No HTML, no script.",
    "",
    "NAMES: rows (the view's rows — a collection), a row's properties by name ([Name with spaces]) inside a row (a list's item, {{#each rows}}, <selected>), title, id, text (what the row's page says — its first lines; show it with <text pre=true>), state.<name> (the view's state), app.<path> (the app's data), db.title, now, this (the current item).",
    "",
    "LAYOUT: <row gap=2 align=center justify=between wrap=true fill=true>, <col gap=2 fill=true width=120> (fill: takes the room left in a row; width: a fixed width in pixels — a column that lines the rows up), <grid cols=3 gap=3 min=220>, <section title=\"…\" aside=\"… (right of the title)\" collapsible=true open=false scroll=20> (open=wide: open on a wide screen, folded on a phone; scroll: at most 20rem high), <box title=\"…\" tone=muted|good|warn|bad>, <heading level=1|2|3>, <text tone=muted pre=true> (pre: keeps the line breaks), <split ratio=1:2> or <split side=right width=352> (two children side by side — a side column of a fixed width; stacked on a phone), <hr/>, <grow/>. Any element: phone=\"hide\" (not on a phone — a second button for what the toolbar does) or phone=\"only\" (only there).",
    "TEXT: <b> <i> <small> <muted> <code> <mono> <truncate> (one line, cut) <strike> — tip=\"…\" on text, tiles, buttons, rows: a tooltip; <clamp lines=3> <chip color=…> <badge color=…> <bar value= max= fill=\"#hex\"/> <dot color=\"#hex or name\"/> <img src= h=/> <a href=…>, <printonly>…</printonly> (only on paper), <noprint>…</noprint>.",
    "FIGURES: <tile label=\"…\" value=\"{{ … }}\" sub=\"…\" tone=good|warn|bad/> — or <tile …>content under the value (text, a part)</tile>.",
    "DATA: <list source=\"rows | …\" select=true open=true spacing=roomy empty=\"…\">item template</list>, <cards source=\"…\" cols=3>item template</cards>, <table source=\"rows | …\" columns=\"title, Status, [Due]\" sum=\"Amount\" empty=\"…\"/>, <chart kind=bar|column|line|pie source=\"rows\" group=\"Status\" value=\"Amount\" calc=count|sum|avg/>, <selected empty=\"…\">template of the row picked (a list with select=true picks)</selected>, <field name=\"Status\"/> (a row's property, editable), <datatable source=\"app.list | …\" empty=\"…\"><column label=\"…\" align=right nowrap=true foot=\"{{ … }}\">cell template (the item's fields by name)</column>…</datatable> (a table of any list).",
    "STATE: <state name=\"dir\" value=\"owe\"/> (a default), <tabs bind=\"dir\" options=\"owe:Label, owed:Label:3\"/> (:3 — a count beside the label), <select bind=… options=… label=…/>, <search bind=\"q\" placeholder=…/> (use it: rows | search(state.q)), <toggle bind=\"done\" label=…/> (state.done is \"true\"/\"\").",
    "PANES: <panes><pane title=\"…\" aside=\"3\" width=300>…</pane><pane title=\"…\" flush=true><ask/></pane><pane title=\"…\" width=360>…</pane></panes> — an app's screen: columns as high as the window, each scrolling by itself, one under the other on a phone. width: pixels, without it a column takes the room left. flush: no padding, for what fills its pane (<ask>).",
    "PAGE: <header title=\"…\" subtitle=\"…\" icon=\"📓\">buttons on its right</header> (a view's top, instead of <heading>), <toolbar>search, filters, buttons</toolbar> (a line with a rule under it), <cover src= h=200 title= subtitle=/> (a wide picture), <callout tone=info|good|warn|bad title=\"…\" icon=\"…\">text</callout>, <empty icon=\"📭\" title=\"…\" text=\"…\">a button</empty> (nothing here yet: what to do), <kv min=200><pair label=\"…\">value</pair>…</kv> (facts, label over value), <steps><step title=\"…\" state=done|active|todo>text</step>…</steps>, <quote cite=\"…\">text</quote>, <divider label=\"…\"/>, <avatar src= name=\"…\" size=32/> (initials without a picture), <logo name=\"{{ Channel }}\" size=sm|lg/> (a channel's mark: Gmail, Outlook, Teams, WhatsApp, Signal, E-Mail; in <tabs> a label \"logo-gmail Gmail\" shows the mark alone), <progress value= max= label=\"…\" tone= show=true/> (show: the percent), <sparkline values=\"1,4,2\" wide=true/>. <tile> also takes icon=\"📈\" trend=\"+12 %\" spark=\"1,4,2\"; <button> also icon=\"➕\".",
    "COLLECTIONS: <gallery source=\"rows\" image=\"{{ Poster }}\" alt=\"{{ title }}\" ratio=2:3|1:1|16:9|3:2 min=150 empty=\"…\">caption</gallery> (a click opens the row), <timeline source=\"rows | sort('Date', 'desc')\" date=\"{{ Date | date }}\" empty=\"…\">item</timeline>, <board source=\"rows\" group=\"Status\" none=\"…\">card</board> (columns by a select or status; a dragged card takes the column's value), <groups source=\"rows\" by=\"Status\"><section title=\"{{ group }}\" aside=\"{{ rows | count }}\"><list source=\"rows\">…</list></section></groups> (what is inside repeats per value: rows is that group's, group its name). page=20 more=\"Show more\" on list, cards, gallery, timeline: that many, and a button for the next.",
    "ENTRY: <facets bind=\"s\" field=\"Status\" all=\"All\"/> (filter pills with counts; narrow with rows | only('Status', state.s)), <quickadd placeholder=\"…\" values=\"Status=Open\"/> (a line: Enter adds a row by its title), <form fields=\"title, Status, Due\" title=\"…\" label=\"Add\" done=\"…\"/> (several fields at once).",
    "LOOKUP: <lookup source=\"tmdb.movies\" placeholder=\"…\" map=\"Poster=poster, Year=year, title=title\" unique=\"TMDB ID\" open=false language=\"de-DE\"/> — a field that searches elsewhere with suggestions; the one picked becomes a row, its fields into the properties of map (Property=field; the properties must exist; title: the row's title, by default its title). unique: a property that tells it is there already, so it isn't added twice. open=true: opens the row. The sources are listed with the language for the AI, and under Settings → Lookups.",
    "KNOWLEDGE: a database's rows as sources — <ask placeholder=\"…\" intro=\"…\" suggest=\"A question|Another\"/>: a conversation answered only from the rows, each statement naming its row, the field at its bottom; plain=true on <dossier>: without a frame, in a pane; <dossier focus=\"what matters\" empty=\"…\"/>: what the rows say together, compiled by the AI with a button, only what changed costs anything. Together with <lookup>, a list and a <text> of sources they make a notebook.",
    `BUTTONS: <button action=… label=\"…\" row=\"{{ id }}\" (the row it acts on, outside a row) variant=primary|plain|quiet|danger|link confirm=\"…\" print=true (also on paper) disabled=\"{{ … }}\" wide=true keys=\"N\" (its key, shown in the tooltip)/> — actions: ${Object.entries(ACTIONS)
      .map(([k, v]) => `${k} (${v.what}${v.row ? "; in a row" : ""})`)
      .join(", ")}${actions.length ? `, ${actions.map((x) => `${x.name} (${x.description})`).join(", ")}` : ""}.`,
    "FILTERS for collections: where(\"Field\", \"value\") or where(\"Field\", \">\", 5) (=, !=, >, <, >=, <=, contains, empty, filled), only(\"Field\", state.s) (where, or all while nothing is picked), sort(\"Field\", \"desc\"), limit(5), search(state.q), count, sum(\"Field\"), avg(\"Field\"), min(\"Field\"), max(\"Field\"), pluck(\"Field\").",
    "FILTERS for values: host (an address's site), euro (euro(0): whole euros), number(2), percent, hours, date, relative, chip, upper, lower, truncate(40), clamp(3), default(\"—\"), join(\", \"), first, last, count, check, bold, muted, small, code, link, img(80), bar(max), initials.",
    "NAV: <nav title=\"…\"><entry label=\"…\" icon=\"📥\" state=\"scope\" value=\"inbox\" n=\"{{ … }}\" group=\"…\"/>…</nav> — the view's sidebar (beside the view, or — its setting — in the Workspace tree under the database); an entry sets the view's state, opens a row (row=\"{{ id }}\" — in {{#each}} the row by itself) or goes to an address (href). E.g. the newest five: {{#each rows | sort('Date', 'desc') | limit(5)}}<entry label=\"{{ title }}\" group=\"Newest\"/>{{/each}}.",
    "WIDGETS: <widget id=\"plugin.widget\" setting=value/> — a plugin's widget (as on pages).",
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
