/**
 * Flows — what a Zeff app does: a sequence of nodes that call actions (a web request, a lookup, an AI extraction, a row
 * written …), branch, loop, run in parallel, catch errors, run a script in a sandbox, wait for you to approve or for a
 * time — every node's output there for the nodes after it (`steps.<id>`). A flow has inputs (a form, a button, a trigger
 * fills them), an output, permissions (what it may reach), triggers. A flow can also be a lookup source (a web recipe).
 * The definitions and their normalization; client-safe.
 */

import { metaOf } from "@/lib/widgets/bridge";

export const FIELD_TYPES = ["text", "number", "boolean", "json", "list", "date", "url", "db", "row"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** An input of a flow (or of an action): its name, its kind, whether it must be given, what it starts with. */
export type FieldSpec = { name: string; type: FieldType; label?: string; required?: boolean; default?: unknown; help?: string; options?: string[] };

/**
 * A value of a node's input: anything JSON. Texts may hold {{ expressions }}: "Hello {{ input.name }}"; a text that is only
 * one {{ … }} becomes that value as it is (a list stays a list).
 */
export type Expr = unknown;

type Base = { id: string; label?: string };

/** A field of a question to you: a scale (min–max, as buttons), a number, a choice of options, yes/no, a text. */
export type AskField = { name: string; label?: string; kind: "scale" | "number" | "choice" | "yesno" | "text"; min?: number; max?: number; options?: string[]; required?: boolean };
export const ASK_KINDS = ["scale", "number", "choice", "yesno", "text"] as const;

export function normalizeAskField(raw: unknown): AskField | null {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const name = typeof o.name === "string" ? o.name.trim().replace(/[^\w-]/g, "_") : "";
  if (!name) return null;
  const kind = (ASK_KINDS as readonly unknown[]).includes(o.kind) ? (o.kind as AskField["kind"]) : "text";
  const num = (v: unknown) => (Number.isFinite(Number(v)) && v !== "" && v !== null ? Number(v) : undefined);
  const options = Array.isArray(o.options) ? o.options.map((x) => String(x).trim()).filter(Boolean).slice(0, 12) : [];
  return {
    name,
    kind,
    ...(typeof o.label === "string" && o.label.trim() ? { label: o.label.trim() } : {}),
    ...(kind === "scale" || kind === "number" ? { min: num(o.min) ?? (kind === "scale" ? 1 : undefined), max: num(o.max) ?? (kind === "scale" ? 10 : undefined) } : {}),
    ...(kind === "choice" ? { options: options.length ? options : ["Yes", "No"] } : {}),
    ...(o.required === false ? {} : kind === "text" ? (o.required === true ? { required: true } : {}) : { required: true }),
  } as AskField;
}

export type FlowNode =
  /** Runs an action of the catalog (actions.ts) with its input. retry: tries again that often; onError=continue: its error is its output. */
  | (Base & { kind: "action"; action: string; input: Record<string, Expr>; retry?: number; onError?: "fail" | "continue" })
  /** Sets variables (vars.<name>). */
  | (Base & { kind: "set"; vars: Record<string, Expr> })
  | (Base & { kind: "if"; when: string; then: FlowNode[]; else: FlowNode[] })
  | (Base & { kind: "switch"; on: string; cases: { value: string; nodes: FlowNode[] }[]; default: FlowNode[] })
  /** Its nodes once per item (item, index; `as` names the item too); its output: the last node's output of each round. */
  | (Base & { kind: "foreach"; items: string; as?: string; nodes: FlowNode[]; max?: number })
  /** The branches side by side; its output: each branch's last output. */
  | (Base & { kind: "parallel"; branches: FlowNode[][] })
  /** Its nodes; when one fails, the catch nodes run with error.message. */
  | (Base & { kind: "try"; nodes: FlowNode[]; catch: FlowNode[] })
  /** JavaScript in a sandbox (QuickJS: no network, no files, a time and memory limit): `input` and `steps` are there, what it returns is its output. */
  | (Base & { kind: "script"; code: string; input?: Record<string, Expr> })
  /**
   * Asks you something and waits for the answer — a card on any page of Zeff (and a notification when you allowed them): its fields
   * (a scale 1–10, a number, a choice, yes/no, a text) are its output ({ <field>: answer, at }). expiresMinutes: unanswered that long,
   * the run ends without it; a new question of the same flow replaces one still open (an hourly check-in doesn't pile up).
   */
  | (Base & { kind: "ask"; title: string; text?: string; fields: AskField[]; expiresMinutes?: number })
  /** Waits for you: a todo and the run console ask; the choice is its output ({ choice, note, at }). */
  | (Base & { kind: "approve"; title: string; text?: string; options?: string[] })
  /** Waits a while (minutes) or until a time (an expression giving an ISO date). */
  | (Base & { kind: "wait"; minutes?: number; until?: string })
  /** Runs another flow by its name with this input; its output is the other's. */
  | (Base & { kind: "call"; flow: string; input: Record<string, Expr> })
  /** Ends the flow with this output. */
  | (Base & { kind: "return"; value: Expr })
  /** Ends the flow as failed. */
  | (Base & { kind: "fail"; message: string });

export type FlowNodeKind = FlowNode["kind"];
export const NODE_KINDS: FlowNodeKind[] = ["action", "set", "if", "switch", "foreach", "parallel", "try", "script", "ask", "approve", "wait", "call", "return", "fail"];

/** What a flow may reach. Nothing beyond Zeff's own reading unless it is granted here. */
export type FlowPermissions = {
  /** Web addresses it may fetch: domains ("api.themoviedb.org", "*.wikipedia.org"), or "*" for any public address. */
  web?: string[];
  /** Databases it may write (ids — a package's own also as "@pkg.iN"), or "all". */
  write?: (number | string)[] | "all";
  /** May make databases (db.ensure) — and write the ones it made. */
  create?: boolean;
  /** May use the AI (costs). */
  ai?: boolean;
  /** May send things out of Zeff (mail, messages). */
  send?: boolean;
  /** May call plugin methods that aren't marked safe for automations. */
  api?: boolean;
  /** The sources it may read into Zeff — a connector's driver ("gcalendar": Google Calendar into Zeff's calendars). */
  sync?: string[];
  /** The parts of Zeff's structure it may read or change (read, pages, databases, schema:<id>, blocks, flows, plugins, delete) — the meta.* actions. */
  meta?: string[];
  /** Most nodes one run may take (default 500). */
  maxSteps?: number;
};

export type FlowTrigger =
  | { kind: "manual" }
  | { kind: "schedule"; everyMinutes?: number; at?: string; days?: number[]; /** Every …: only between these times ("08:00" – "22:00"). */ from?: string; to?: string }
  | { kind: "event"; event: "row.added" | "row.changed" | "row.removed" | "signal" | "form.submitted" | "transition"; db?: number; field?: string; equals?: string; name?: string };

/** A flow as a lookup source: search(q) gives hits, details(id) the fields — the flow is called with input.mode "search" | "details". */
export type FlowLookup = { label: string; what: string; /** The fields its details give: name → what it is. */ fields: Record<string, string>; /** Searches take long or cost (the AI, a slow site): only on Enter. */ slow?: boolean };

export type FlowDef = {
  /** Its name — how templates, other flows and the AI call it ("movie.enrich"). */
  name: string;
  title?: string;
  description?: string;
  inputs: FieldSpec[];
  nodes: FlowNode[];
  /** What it gives back (an expression over steps, vars, input); none: the last node's output. */
  output?: Expr;
  permissions: FlowPermissions;
  /** What the AI asked for when it wrote the flow (over the MCP): granted only by you, in the Studio. */
  requested?: FlowPermissions;
  triggers: FlowTrigger[];
  lookup?: FlowLookup;
  /** A sync (a connector's: reading a source into Zeff): a step of its own in the Sync menu — run there, its runs its history, its schedule its interval. */
  sync?: { label: string; what?: string; /** Runs by itself only while the automation Chrome runs. */ chrome?: boolean; /** The built-in's step it stands for (a port's: "gcalendar") — its interval on the Sync settings page is this flow's. */ replaces?: string };
  enabled?: boolean;
};

export const FLOW_NAME = /^[a-z][a-z0-9_-]*(\.[a-z0-9_-]+)*$/;

// ---------------------------------------------------------------------------
// Normalizing (what is stored, what the AI or the Studio wrote)
// ---------------------------------------------------------------------------

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const posInt = (v: unknown): number | undefined => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : undefined;
};
let seq = 0;
const freshId = (kind: string) => `${kind}${++seq}${Math.random().toString(36).slice(2, 5)}`;

export function normalizeField(raw: unknown): FieldSpec | null {
  const o = obj(raw);
  const name = str(o.name);
  if (!name) return null;
  const type = (FIELD_TYPES as readonly unknown[]).includes(o.type) ? (o.type as FieldType) : "text";
  const options = Array.isArray(o.options) ? o.options.map(str).filter(Boolean) : [];
  return { name, type, ...(str(o.label) ? { label: str(o.label) } : {}), ...(o.required === true ? { required: true } : {}), ...(o.default !== undefined ? { default: o.default } : {}), ...(str(o.help) ? { help: str(o.help) } : {}), ...(options.length ? { options } : {}) };
}

const exprs = (v: unknown): Record<string, Expr> => Object.fromEntries(Object.entries(obj(v)).filter(([k]) => !!k.trim()));

export function normalizeNodes(raw: unknown, depth = 0, ids = new Set<string>()): FlowNode[] {
  if (!Array.isArray(raw) || depth > 8) return [];
  const out: FlowNode[] = [];
  for (const x of raw) {
    const o = obj(x);
    let id = str(o.id).replace(/[^\w-]/g, "_");
    if (!id || ids.has(id)) id = freshId(str(o.kind) || "n");
    ids.add(id);
    const base = { id, ...(str(o.label) ? { label: str(o.label) } : {}) };
    const sub = (v: unknown) => normalizeNodes(v, depth + 1, ids);
    switch (o.kind) {
      case "action":
        if (str(o.action)) out.push({ ...base, kind: "action", action: str(o.action), input: exprs(o.input), ...(posInt(o.retry) ? { retry: Math.min(5, posInt(o.retry)!) } : {}), ...(o.onError === "continue" ? { onError: "continue" as const } : {}) });
        break;
      case "set":
        out.push({ ...base, kind: "set", vars: exprs(o.vars) });
        break;
      case "if":
        out.push({ ...base, kind: "if", when: str(o.when), then: sub(o.then), else: sub(o.else) });
        break;
      case "switch":
        out.push({ ...base, kind: "switch", on: str(o.on), cases: (Array.isArray(o.cases) ? o.cases : []).map((c) => ({ value: String(obj(c).value ?? ""), nodes: sub(obj(c).nodes) })), default: sub(o.default) });
        break;
      case "foreach":
        if (str(o.items)) out.push({ ...base, kind: "foreach", items: str(o.items), ...(str(o.as) ? { as: str(o.as) } : {}), nodes: sub(o.nodes), ...(posInt(o.max) ? { max: Math.min(1000, posInt(o.max)!) } : {}) });
        break;
      case "parallel":
        out.push({ ...base, kind: "parallel", branches: (Array.isArray(o.branches) ? o.branches : []).slice(0, 8).map((b) => sub(b)) });
        break;
      case "try":
        out.push({ ...base, kind: "try", nodes: sub(o.nodes), catch: sub(o.catch) });
        break;
      case "script":
        if (typeof o.code === "string" && o.code.trim()) out.push({ ...base, kind: "script", code: o.code.slice(0, 50000), ...(o.input ? { input: exprs(o.input) } : {}) });
        break;
      case "approve": {
        const options = Array.isArray(o.options) ? o.options.map(str).filter(Boolean).slice(0, 6) : [];
        out.push({ ...base, kind: "approve", title: str(o.title) || "Approve?", ...(str(o.text) ? { text: str(o.text) } : {}), ...(options.length ? { options } : {}) });
        break;
      }
      case "ask": {
        const fields = (Array.isArray(o.fields) ? o.fields : []).map(normalizeAskField).filter((f): f is AskField => !!f).slice(0, 8);
        const exp = posInt(o.expiresMinutes);
        out.push({ ...base, kind: "ask", title: str(o.title) || "?", ...(str(o.text) ? { text: str(o.text) } : {}), fields: fields.length ? fields : [{ name: "answer", kind: "text", required: true }], ...(exp ? { expiresMinutes: Math.min(60 * 24 * 14, exp) } : {}) });
        break;
      }
      case "wait":
        out.push({ ...base, kind: "wait", ...(posInt(o.minutes) ? { minutes: Math.min(60 * 24 * 60, posInt(o.minutes)!) } : {}), ...(str(o.until) ? { until: str(o.until) } : {}) });
        break;
      case "call":
        if (str(o.flow)) out.push({ ...base, kind: "call", flow: str(o.flow), input: exprs(o.input) });
        break;
      case "return":
        out.push({ ...base, kind: "return", value: o.value ?? null });
        break;
      case "fail":
        out.push({ ...base, kind: "fail", message: str(o.message) || "Failed." });
        break;
    }
  }
  return out;
}

/** The connectors' drivers a flow can be allowed to read into Zeff (FlowPermissions.sync). */
export const SYNC_SOURCES = ["gcalendar"];

function normalizePermissions(raw: unknown): FlowPermissions {
  const o = obj(raw);
  const web = Array.isArray(o.web) ? [...new Set(o.web.map(str).filter((d) => d === "*" || /^(\*\.)?[a-z0-9.-]+\.[a-z]{2,}$/i.test(d)).map((d) => d.toLowerCase()))] : [];
  // (a database by its id — or a package's own by its place in it, "@my-pkg.i3", whatever id it got when installed)
  const writeOne = (x: unknown): number | string | undefined => (typeof x === "string" && /^@[a-z0-9][a-z0-9.-]*\.i\d+$/.test(x.trim()) ? x.trim() : posInt(x));
  const write = o.write === "all" ? ("all" as const) : Array.isArray(o.write) ? [...new Set(o.write.map(writeOne).filter((n): n is number | string => !!n))] : [];
  return {
    ...(web.length ? { web } : {}),
    ...(write === "all" || write.length ? { write } : {}),
    ...(o.create === true ? { create: true } : {}),
    ...(o.ai === true ? { ai: true } : {}),
    ...(o.send === true ? { send: true } : {}),
    ...(o.api === true ? { api: true } : {}),
    ...(Array.isArray(o.sync) && o.sync.map(str).filter((x) => SYNC_SOURCES.includes(x)).length ? { sync: [...new Set(o.sync.map(str).filter((x) => SYNC_SOURCES.includes(x)))] } : {}),
    ...(metaOf(o.meta).length ? { meta: metaOf(o.meta) } : {}),
    ...(posInt(o.maxSteps) ? { maxSteps: Math.min(20000, posInt(o.maxSteps)!) } : {}),
  };
}

const EVENTS = ["row.added", "row.changed", "row.removed", "signal", "form.submitted", "transition"] as const;

function normalizeTrigger(raw: unknown): FlowTrigger | null {
  const o = obj(raw);
  if (o.kind === "manual") return { kind: "manual" };
  if (o.kind === "schedule") {
    const every = posInt(o.everyMinutes);
    const at = /^\d{1,2}:\d{2}$/.test(str(o.at)) ? str(o.at).padStart(5, "0") : "";
    const days = Array.isArray(o.days) ? [...new Set(o.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [];
    const time = (v: unknown) => (/^\d{1,2}:\d{2}$/.test(str(v)) ? str(v).padStart(5, "0") : "");
    if (every) return { kind: "schedule", everyMinutes: Math.max(5, Math.min(10080, every)), ...(days.length ? { days } : {}), ...(time(o.from) ? { from: time(o.from) } : {}), ...(time(o.to) ? { to: time(o.to) } : {}) };
    if (at) return { kind: "schedule", at, ...(days.length ? { days } : {}) };
    return null;
  }
  if (o.kind === "event" && (EVENTS as readonly unknown[]).includes(o.event)) {
    const db = posInt(o.db);
    return { kind: "event", event: o.event as (typeof EVENTS)[number], ...(db ? { db } : {}), ...(str(o.field) ? { field: str(o.field) } : {}), ...(str(o.equals) ? { equals: str(o.equals) } : {}), ...(str(o.name) ? { name: str(o.name) } : {}) };
  }
  return null;
}

/** A flow as it can be: its name checked, its nodes known, ids unique. Throws when it has no name. */
export function normalizeFlow(raw: unknown): FlowDef {
  const o = obj(raw);
  const name = str(o.name).toLowerCase();
  if (!FLOW_NAME.test(name)) throw new Error(`A flow's name is lowercase letters, digits, - and _, parts joined by dots ("movie.enrich") — not “${str(o.name)}”.`);
  const lk = obj(o.lookup);
  const lkFields: Record<string, string> = Array.isArray(lk.fields) ? Object.fromEntries(lk.fields.map(str).filter(Boolean).map((k) => [k, k])) : Object.fromEntries(Object.entries(obj(lk.fields)).filter(([k]) => !!k.trim()).map(([k, v]) => [k.trim(), str(v) || k.trim()]));
  const lookup = str(lk.label) ? { label: str(lk.label), what: str(lk.what), fields: lkFields, ...(lk.slow === true ? { slow: true } : {}) } : undefined;
  const sy = obj(o.sync);
  const sync = str(sy.label) ? { label: str(sy.label).slice(0, 60), ...(str(sy.what) ? { what: str(sy.what).slice(0, 300) } : {}), ...(sy.chrome === true ? { chrome: true } : {}), ...(/^[a-z][a-z0-9-]{0,40}$/.test(str(sy.replaces)) ? { replaces: str(sy.replaces) } : {}) } : undefined;
  const triggers = (Array.isArray(o.triggers) ? o.triggers : []).map(normalizeTrigger).filter((t): t is FlowTrigger => !!t);
  return {
    name,
    ...(str(o.title) ? { title: str(o.title) } : {}),
    ...(str(o.description) ? { description: str(o.description) } : {}),
    inputs: (Array.isArray(o.inputs) ? o.inputs : []).map(normalizeField).filter((f): f is FieldSpec => !!f),
    nodes: normalizeNodes(o.nodes),
    ...(o.output !== undefined && o.output !== null && o.output !== "" ? { output: o.output } : {}),
    permissions: normalizePermissions(o.permissions),
    ...(o.requested && Object.keys(normalizePermissions(o.requested)).length ? { requested: normalizePermissions(o.requested) } : {}),
    triggers: triggers.length ? triggers : [{ kind: "manual" }],
    ...(lookup ? { lookup } : {}),
    ...(sync ? { sync } : {}),
    enabled: o.enabled !== false,
  };
}

/** Every node of a flow, nested ones too, with its depth. */
export function walkNodes(nodes: FlowNode[], visit: (n: FlowNode, depth: number) => void, depth = 0): void {
  for (const n of nodes) {
    visit(n, depth);
    if (n.kind === "if") (walkNodes(n.then, visit, depth + 1), walkNodes(n.else, visit, depth + 1));
    else if (n.kind === "switch") (n.cases.forEach((c) => walkNodes(c.nodes, visit, depth + 1)), walkNodes(n.default, visit, depth + 1));
    else if (n.kind === "foreach" || n.kind === "try") (walkNodes(n.nodes, visit, depth + 1), n.kind === "try" && walkNodes(n.catch, visit, depth + 1));
    else if (n.kind === "parallel") n.branches.forEach((b) => walkNodes(b, visit, depth + 1));
  }
}
