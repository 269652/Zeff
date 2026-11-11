/**
 * What a widget may ask of Zeff — the one way out of its sandbox besides its result and height (sandbox.ts). A widget is a
 * small program an AI writes on the fly: a quiz (Learn), a form that fills a database, a calculator, a chart of a table, a
 * little app. It calls `zeff.call(method, args)` (or the short forms: zeff.db.rows, zeff.db.add …); the page that shows it
 * checks the call here, answers what it can itself (its state, a note) and hands the rest to the server, which checks again:
 *
 *   read   the databases' rows and fields — what isn't secret (the boundaries)
 *   write  a row added or changed — only in a database the user allowed this widget (its grant; the AI can only ask for one)
 *   ai     a question to the AI — only when allowed, and a few an hour
 *   host   the widget's own state, a note, a row opened — the page does it
 *
 * The grant belongs to the widget's code (widgetKey: changed code, asked again) — wherever it is shown. Client-safe (pure).
 */

export type CallNeed = "read" | "write" | "ai" | "flow" | "host";
export type CallMethod = { need: CallNeed; args: string; returns: string; what: string };

export const CALL_METHODS = {
  "db.list": { need: "read", args: "", returns: "[{ id, title, rows }]", what: "the databases there are" },
  "db.schema": { need: "read", args: "{ db }", returns: "{ id, title, titleName, fields: [{ name, type, options? }] }", what: "a database's fields (db: its id or title)" },
  "db.rows": {
    need: "read",
    args: "{ db, where?, contains?, sort?, desc?, limit? }",
    returns: "{ total, rows: [{ id, title, values: { field: value } }] }",
    what: "a database's rows — where: { field: value } (equal; a list: one of them), contains: text anywhere, sort: a field, limit (200 at most)",
  },
  "db.add": { need: "write", args: "{ db, values }", returns: "{ id }", what: "a new row — values by field name (the title under its name or \"title\"; choices by name, a new name makes the option)" },
  "db.update": { need: "write", args: "{ db, row, values }", returns: "{ id }", what: "change a row of that database (row: its id)" },
  ai: { need: "ai", args: "{ prompt, schema? }", returns: "{ text } — or the object of the JSON schema", what: "ask the AI (a few times an hour)" },
  "flow.list": { need: "read", args: "", returns: "[{ name, title, description, inputs: [{ name, type }] }]", what: "the flows there are (Zeff's server side)" },
  "flow.run": { need: "flow", args: "{ flow, input? }", returns: "{ status: done|waiting|failed, output, error }", what: "run a flow — the server side: web requests and APIs, reading web pages, lookups, AI extraction, writing rows (what the flow may reach are the flow's own permissions)" },
  "page.get": { need: "host", args: "{ key? }", returns: "the value (no key: all of them as an object)", what: "what the widgets on this page share — kept with the page" },
  "page.set": { need: "host", args: "{ key, value }", returns: "true", what: 'share a value with the other widgets on the page (JSON, 50 000 characters at most); they hear zeff.on("page", ({ key, value }) => …)' },
  "bus.last": { need: "host", args: "{ name }", returns: "what was last sent under that name (null: nothing yet)", what: "the last message the other widgets sent with zeff.emit(name, …) — a widget that loads later asks for it (zeff.on does it itself)" },
  publish: { need: "host", args: "{ name, value, unit?, label? }", returns: "true", what: "publish a value for the whole of Zeff — a number, a text, a list, a table (a list of rows): other widgets anywhere read it (values.get, and hear zeff.on(\"value\", ({ name, value }) => …)), views show it, a number is a Kennzahl (formulas: kennzahl(\"name\")), the assistant can pour a table into a database. A name is this widget's once it published it; null removes it" },
  "values.get": { need: "read", args: "{ name }", returns: "the value (null: nothing published by that name)", what: "a value a widget published (anywhere in Zeff)" },
  "values.list": { need: "read", args: "", returns: "[{ name, label, kind: number|text|list|table|json, unit, widget, updatedAt }]", what: "the values widgets published" },
  emit: { need: "host", args: "{ name, detail? }", returns: "true", what: "a message to the other widgets on this page: they hear zeff.on(name, detail => …)" },
  "state.get": { need: "host", args: "", returns: "the value", what: "what this widget kept (its own memory — survives a reload)" },
  "state.set": { need: "host", args: "{ value }", returns: "true", what: "keep a value (JSON, 50 000 characters at most)" },
  toast: { need: "host", args: "{ text }", returns: "true", what: "a short note at the edge of the page" },
  open: { need: "host", args: "{ row }", returns: "true", what: "open a row's (a page's) page" },
} as const satisfies Record<string, CallMethod>;

export type CallName = keyof typeof CALL_METHODS;
export const isCallName = (v: unknown): v is CallName => typeof v === "string" && Object.prototype.hasOwnProperty.call(CALL_METHODS, v);

/** The most a call's arguments may be (as JSON). */
export const MAX_CALL_ARGS = 200_000;
/** The most a widget's state may be (as JSON). */
export const MAX_STATE = 50_000;

/** What a widget asks to be allowed (kept with it: the block, the chat's answer, the Markdown) — the user grants it, or not. */
export type WidgetWants = { writes: number[]; ai?: boolean; /** Flows it runs (by name). */ flows?: string[] };
/** What the user allowed a widget's code: the databases it may write to, whether it may ask the AI, the flows it may run. */
export type WidgetGrant = { dbs: number[]; ai?: boolean; flows?: string[] };

/** Flow names as kept (a list, or a block's "a.b,c"), cleaned: a flow's name, each once, 20 at most. */
export function flowsOf(v: unknown): string[] {
  const raw = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  return [...new Set(raw.map((x) => String(x).trim().toLowerCase()).filter((x) => /^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/.test(x)))].slice(0, 20);
}

export const noWants: WidgetWants = { writes: [] };

/** Wants as kept (a list of ids, or a block's "12,7"), cleaned: whole ids above 0, each once, 20 at most. */
export function wantsOf(writes: unknown, ai?: unknown, flows?: unknown): WidgetWants {
  const raw = Array.isArray(writes) ? writes : typeof writes === "string" ? writes.split(",") : typeof writes === "number" ? [writes] : [];
  const ids = [...new Set(raw.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 20);
  const f = flowsOf(flows);
  return { writes: ids, ...(ai === true || ai === "true" ? { ai: true } : {}), ...(f.length ? { flows: f } : {}) };
}

/** What of a widget's wants isn't granted yet (nothing: it may do all it asks). */
export function missing(wants: WidgetWants, grant: WidgetGrant | null): WidgetWants {
  const dbs = new Set(grant?.dbs ?? []);
  const flows = (wants.flows ?? []).filter((f) => !(grant?.flows ?? []).includes(f));
  return { writes: wants.writes.filter((d) => !dbs.has(d)), ...(wants.ai && !grant?.ai ? { ai: true } : {}), ...(flows.length ? { flows } : {}) };
}

/**
 * A widget's key: a hash of its code (cyrb53, both halves — 14 hex digits). What the user granted is kept by it, so a widget
 * whose code changed (the AI rebuilt it, someone edited it) asks again.
 */
export function widgetKey(html: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < html.length; i++) {
    const c = html.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `w${(h2 >>> 0).toString(16).padStart(8, "0")}${(h1 >>> 0).toString(16).padStart(8, "0")}`.slice(0, 15);
}

/** A call from a widget, checked: a known method, an id, arguments that are an object (or none) and not too big. */
export type WidgetCall = { id: number; method: CallName; args: Record<string, unknown> };

export function parseCall(m: Record<string, unknown>): WidgetCall | null {
  if (!Number.isInteger(m.id) || (m.id as number) < 1 || !isCallName(m.method)) return null;
  const a = m.args === undefined || m.args === null ? {} : m.args;
  if (typeof a !== "object" || Array.isArray(a)) return null;
  try {
    if (JSON.stringify(a).length > MAX_CALL_ARGS) return null;
  } catch {
    return null;
  }
  return { id: m.id as number, method: m.method, args: a as Record<string, unknown> };
}
