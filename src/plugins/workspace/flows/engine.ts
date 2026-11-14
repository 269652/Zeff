import { checkedUrl, flowAction, type ActionCtx } from "./actions";
import { fill, holds, evalExpr, text, type Scope } from "./expr";
import { runScript } from "./sandbox";
import { askUser, answerAsk, cancelAsk, expireAsks, type Ask } from "../asks";
import { dueRuns, flowByName, getFlowRun, grantWrite, listFlows, saveFlowRun, secretValues, startFlowRun, type Flow, type FlowRun, type Journal, type LogEntry, type Waiting } from "./store";
import type { FieldSpec, FlowDef, FlowNode, FlowPermissions } from "./types";

/**
 * The flow engine. A run goes through the nodes in order; what a node gives is `steps.<id>` for the ones after it. What reaches
 * outside or costs (an action, a script, a sub-flow's nodes, an approval, a wait) is written into the run's journal: a run that
 * waits (for your approval, for a time) is taken up again from its start, and every node already done gives its journaled output
 * instead of running again — so nothing is fetched, written or asked twice. Every node is logged (its input, its output, how long
 * it took) — the Studio's run console. Server only.
 */

class Suspend extends Error {
  constructor(readonly waiting: Waiting) {
    super("waiting");
  }
}
class Return extends Error {
  constructor(readonly value: unknown) {
    super("return");
  }
}
class Failed extends Error {}

export type RunOptions = {
  trigger?: unknown;
  /** A dry run: what writes or sends is not done (its log says what would be); reading, searching, the AI run. */
  dry?: boolean;
  /** The row the run is about (a button in a row, a row event): `row` in its expressions. */
  row?: number;
  /** For tests: what a node of the web resolves to. */
  resolve?: (host: string) => Promise<string[]>;
};

export type RunResult = { runId: number; status: FlowRun["status"]; output: unknown; error: string | null; waiting: Waiting | null };

type Ctx = {
  runId: number;
  flow: string;
  perms: FlowPermissions;
  dry: boolean;
  journal: Journal;
  log: LogEntry[];
  steps: Record<string, unknown>;
  vars: Record<string, unknown>;
  base: Scope;
  count: { n: number; max: number };
  secrets: Record<string, string>;
  depth: number;
  resolve?: RunOptions["resolve"];
};

const MAX_LOG_VALUE = 4000;

/** A value as the log keeps it: secrets hidden, long texts and big objects cut. */
function forLog(v: unknown, secrets: Record<string, string>): unknown {
  if (v === undefined) return undefined;
  let s: string;
  try {
    s = JSON.stringify(v) ?? "null";
  } catch {
    s = String(v);
  }
  for (const value of Object.values(secrets)) if (value.length >= 4) s = s.split(value).join("•••");
  if (s.length > MAX_LOG_VALUE) return `${s.slice(0, MAX_LOG_VALUE)}… (${s.length} characters)`;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/** A run's output never carries a secret: its value is •••. */
function hideSecrets(v: unknown, secrets: Record<string, string>): unknown {
  const values = Object.values(secrets).filter((s) => s.length >= 4);
  if (!values.length || v === undefined || v === null) return v ?? null;
  const s = JSON.stringify(v);
  if (!values.some((x) => s.includes(x))) return v;
  return JSON.parse(values.reduce((acc, x) => acc.split(JSON.stringify(x).slice(1, -1)).join("•••"), s));
}

const scopeOf = (ctx: Ctx, extra: Scope = {}): Scope => ({ ...ctx.base, steps: ctx.steps, vars: ctx.vars, secrets: ctx.secrets, ...extra });

function logNode(ctx: Ctx, n: FlowNode, key: string, depth: number, e: Partial<LogEntry> & { status: LogEntry["status"]; ms: number }) {
  ctx.log.push({ key, node: n.id, kind: n.kind, ...(n.label ? { label: n.label } : {}), ...(n.kind === "action" ? { action: n.action } : {}), depth, at: new Date().toISOString(), ...e, input: forLog(e.input, ctx.secrets), output: forLog(e.output, ctx.secrets), ...(e.error ? { error: String(forLog(e.error, ctx.secrets)) } : {}) });
  if (ctx.log.length > 2000) ctx.log.splice(0, ctx.log.length - 2000);
}

function actionCtx(ctx: Ctx, logs: string[]): ActionCtx {
  return {
    flow: ctx.flow,
    runId: ctx.runId,
    dryRun: ctx.dry,
    perms: ctx.perms,
    web: (url) => checkedUrl(url, ctx.perms, ctx.resolve),
    canWrite: (dbId) => {
      const w = ctx.perms.write;
      if (!(w === "all" || (Array.isArray(w) && w.includes(dbId)))) throw new Error(`This flow may not write the database ${dbId} — grant it under the flow's permissions (write).`);
    },
    may: (need) => {
      if (!ctx.perms[need]) throw new Error(`This flow may not ${need === "ai" ? "use the AI" : need === "send" ? "send anything out" : need === "create" ? "make databases" : "call that plugin method"} — grant it under the flow's permissions (${need}).`);
    },
    grantWrite: (dbId) => {
      const w = ctx.perms.write;
      if (w !== "all") ctx.perms = { ...ctx.perms, write: [...(Array.isArray(w) ? w : []), dbId] };
      grantWrite(ctx.flow, dbId);
    },
    log: (line) => logs.length < 200 && logs.push(line),
  };
}

/** A node's output, journaled: taken from the journal when the run is taken up again. */
async function journaled(ctx: Ctx, key: string, fn: () => Promise<unknown>): Promise<{ output: unknown; replayed: boolean }> {
  if (key in ctx.journal) return { output: ctx.journal[key].output, replayed: true };
  const output = await fn();
  ctx.journal[key] = { output: output === undefined ? null : output, at: new Date().toISOString() };
  return { output, replayed: false };
}

async function runNodes(nodes: FlowNode[], ctx: Ctx, prefix: string, depth: number, extra: Scope = {}): Promise<unknown> {
  let last: unknown = null;
  for (const n of nodes) {
    last = await runNode(n, ctx, prefix, depth, extra);
    ctx.steps[n.id] = last;
  }
  return last;
}

async function runNode(n: FlowNode, ctx: Ctx, prefix: string, depth: number, extra: Scope): Promise<unknown> {
  if (++ctx.count.n > ctx.count.max) throw new Failed(`The flow took more than ${ctx.count.max} steps (a loop?) — raise maxSteps in its permissions if it is meant.`);
  const key = `${prefix}${n.id}`;
  const scope = () => scopeOf(ctx, extra);
  const t0 = Date.now();
  switch (n.kind) {
    case "set": {
      const vals = fill(n.vars, scope()) as Record<string, unknown>;
      Object.assign(ctx.vars, vals);
      logNode(ctx, n, key, depth, { status: "ok", ms: Date.now() - t0, output: vals });
      return vals;
    }
    case "if": {
      const yes = holds(n.when, scope());
      logNode(ctx, n, key, depth, { status: "ok", ms: 0, output: { branch: yes ? "then" : "else" } });
      return runNodes(yes ? n.then : n.else, ctx, prefix, depth + 1, extra);
    }
    case "switch": {
      const v = text(evalExpr(n.on, scope()));
      const hit = n.cases.find((c) => c.value === v);
      logNode(ctx, n, key, depth, { status: "ok", ms: 0, output: { value: v, case: hit ? hit.value : "default" } });
      return runNodes(hit ? hit.nodes : n.default, ctx, prefix, depth + 1, extra);
    }
    case "foreach": {
      const raw = evalExpr(n.items.replace(/^\{\{([\s\S]*)\}\}$/, "$1"), scope());
      const items = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? Object.entries(raw).map(([k, v]) => ({ key: k, value: v })) : raw === null || raw === undefined ? [] : [raw];
      const max = n.max ?? 500;
      logNode(ctx, n, key, depth, { status: "ok", ms: 0, output: { items: items.length, ...(items.length > max ? { only: max } : {}) } });
      const out: unknown[] = [];
      for (const [index, item] of items.slice(0, max).entries()) out.push(await runNodes(n.nodes, ctx, `${key}#${index}/`, depth + 1, { ...extra, item, index, ...(n.as ? { [n.as]: item } : {}) }));
      return out;
    }
    case "parallel": {
      logNode(ctx, n, key, depth, { status: "ok", ms: 0, output: { branches: n.branches.length } });
      return Promise.all(n.branches.map((b, i) => runNodes(b, ctx, `${key}|${i}/`, depth + 1, extra)));
    }
    case "try": {
      try {
        return await runNodes(n.nodes, ctx, `${key}/`, depth + 1, extra);
      } catch (e) {
        if (e instanceof Suspend || e instanceof Return) throw e;
        const message = e instanceof Error ? e.message : String(e);
        logNode(ctx, n, key, depth, { status: "ok", ms: 0, output: { caught: message } });
        return runNodes(n.catch, ctx, `${key}!/`, depth + 1, { ...extra, error: { message } });
      }
    }
    case "return":
      throw new Return(fill(n.value, scope()));
    case "fail":
      throw new Failed(text(fill(n.message, scope())));
    case "action": {
      const def = flowAction(n.action);
      if (!def) throw new Failed(`There is no action “${n.action}”.`);
      const input = fill(n.input, scope()) as Record<string, unknown>;
      for (const fld of def.input) if (fld.required && (input[fld.name] === undefined || input[fld.name] === null || input[fld.name] === "")) throw new Failed(`${n.label || n.id}: ${def.label} needs “${fld.name}”.`);
      if (ctx.dry && def.writes) {
        logNode(ctx, n, key, depth, { status: "dry", ms: 0, input, output: { dryRun: true } });
        return { dryRun: true, would: def.label, input };
      }
      const logs: string[] = [];
      let attempt = 0;
      for (;;) {
        try {
          const r = await journaled(ctx, key, async () => def.run(input, actionCtx(ctx, logs)));
          if (!r.replayed) logNode(ctx, n, key, depth, { status: "ok", ms: Date.now() - t0, input, output: r.output, ...(logs.length ? { logs } : {}) });
          return r.output;
        } catch (e) {
          if (attempt++ < (n.retry ?? 0)) {
            await new Promise((res) => setTimeout(res, Math.min(8000, 500 * 2 ** attempt)));
            continue;
          }
          const message = e instanceof Error ? e.message : String(e);
          logNode(ctx, n, key, depth, { status: "failed", ms: Date.now() - t0, input, error: message, ...(logs.length ? { logs } : {}) });
          if (n.onError === "continue") return { error: message };
          throw new Failed(`${n.label || n.id} (${def.label}): ${message}`);
        }
      }
    }
    case "script": {
      const input = fill(n.input ?? {}, scope());
      const r = await journaled(ctx, key, async () => {
        const res = await runScript(n.code, { input, steps: ctx.steps, vars: ctx.vars, item: extra.item ?? null, index: extra.index ?? null, flowInput: ctx.base.input ?? {}, row: ctx.base.row ?? null, env: ctx.base.env ?? {} });
        if (!res.ok) {
          logNode(ctx, n, key, depth, { status: "failed", ms: res.ms, input, error: res.error, logs: res.logs });
          throw new Failed(`${n.label || n.id} (script): ${res.error}`);
        }
        logNode(ctx, n, key, depth, { status: "ok", ms: res.ms, input, output: res.value, ...(res.logs.length ? { logs: res.logs } : {}) });
        return res.value;
      });
      return r.output;
    }
    case "call": {
      if (ctx.depth >= 5) throw new Failed("Flows call each other too deep (a loop?).");
      const sub = flowByName(n.flow);
      if (!sub) throw new Failed(`There is no flow “${n.flow}”.`);
      const input = withDefaults(sub.inputs, fill(n.input, scope()) as Record<string, unknown>);
      logNode(ctx, n, key, depth, { status: "ok", ms: 0, input, output: { flow: sub.name } });
      const child: Ctx = { ...ctx, flow: sub.name, perms: sub.permissions, steps: {}, vars: {}, base: { ...ctx.base, input }, depth: ctx.depth + 1, count: ctx.count };
      try {
        const last = await runNodes(sub.nodes, child, `${key}>`, depth + 1);
        return sub.output !== undefined ? fill(sub.output, scopeOf(child)) : last;
      } catch (e) {
        if (e instanceof Return) return e.value;
        throw e;
      }
    }
    case "approve": {
      if (key in ctx.journal) return ctx.journal[key].output;
      const title = text(fill(n.title, scope()));
      const body = n.text ? text(fill(n.text, scope())) : undefined;
      if (ctx.dry) {
        logNode(ctx, n, key, depth, { status: "dry", ms: 0, output: { choice: n.options?.[0] ?? "yes" } });
        return { choice: n.options?.[0] ?? "yes", dryRun: true };
      }
      logNode(ctx, n, key, depth, { status: "waiting", ms: 0, output: { title } });
      const options = n.options?.length ? n.options : ["yes", "no"];
      // (An approval is a question with a choice — and a note, if you like.)
      throw new Suspend({ key, kind: "approve", title, ...(body ? { text: body } : {}), options, fields: [{ name: "choice", kind: "choice", options, required: true }, { name: "note", kind: "text" }] });
    }
    case "ask": {
      if (key in ctx.journal) return ctx.journal[key].output;
      const title = text(fill(n.title, scope()));
      const body = n.text ? text(fill(n.text, scope())) : undefined;
      if (ctx.dry) {
        const sample = Object.fromEntries(n.fields.map((f) => [f.name, f.kind === "scale" || f.kind === "number" ? (f.min ?? 1) : f.kind === "choice" ? (f.options?.[0] ?? "") : f.kind === "yesno" ? true : ""]));
        logNode(ctx, n, key, depth, { status: "dry", ms: 0, output: sample });
        return { ...sample, dryRun: true };
      }
      logNode(ctx, n, key, depth, { status: "waiting", ms: 0, output: { title } });
      throw new Suspend({ key, kind: "ask", title, ...(body ? { text: body } : {}), fields: n.fields, ...(n.expiresMinutes ? { expiresMinutes: n.expiresMinutes } : {}) });
    }
    case "wait": {
      const entry = ctx.journal[key];
      if (entry && entry.until && Date.now() >= Date.parse(entry.until)) {
        if (entry.output === null) {
          ctx.journal[key] = { ...entry, output: { waited: true, until: entry.until } };
          logNode(ctx, n, key, depth, { status: "ok", ms: 0, output: { waited: true } });
        }
        return ctx.journal[key].output;
      }
      const until = entry?.until ?? (n.until ? new Date(text(evalExpr(n.until.replace(/^\{\{([\s\S]*)\}\}$/, "$1"), scope()))).toISOString() : new Date(Date.now() + (n.minutes ?? 1) * 60000).toISOString());
      if (Number.isNaN(Date.parse(until))) throw new Failed(`${n.label || n.id}: “${n.until}” gives no time to wait for.`);
      if (Date.now() >= Date.parse(until) || ctx.dry) return { waited: false, until };
      if (!entry) {
        ctx.journal[key] = { output: null, at: new Date().toISOString(), until };
        logNode(ctx, n, key, depth, { status: "waiting", ms: 0, output: { until } });
      }
      throw new Suspend({ key, kind: "wait", until });
    }
  }
}

/** An input with its fields' defaults, the required ones checked, numbers and true/false made so. */
export function withDefaults(fields: FieldSpec[], given: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...given };
  for (const f of fields) {
    let v = out[f.name];
    if ((v === undefined || v === null || v === "") && f.default !== undefined) v = f.default;
    if ((v === undefined || v === null || v === "") && f.required) throw new Error(`The input “${f.label || f.name}” is required.`);
    if (f.type === "number" && typeof v === "string" && v.trim()) v = Number(v.replace(",", "."));
    if (f.type === "boolean" && typeof v === "string") v = v === "true" || v === "yes" || v === "1";
    if ((f.type === "json" || f.type === "list") && typeof v === "string" && /^\s*[[{]/.test(v)) {
      try {
        v = JSON.parse(v);
      } catch {
        // stays text
      }
    }
    if (f.type === "list" && typeof v === "string") v = v.split(",").map((x) => x.trim()).filter(Boolean);
    if (v !== undefined) out[f.name] = v;
  }
  return out;
}

async function rowScope(rowId: number | undefined): Promise<Scope> {
  if (!rowId) return {};
  const { getPage, rowsOf } = await import("../store");
  const page = getPage(rowId);
  if (!page?.dbId) return {};
  const d = rowsOf(page.dbId);
  const row = d?.rows.find((r) => r.id === rowId);
  if (!d || !row) return {};
  const { rowObject } = await import("./actions");
  return { row: { ...rowObject(d.schema, row), database: page.dbId } };
}

/**
 * Goes through a run's nodes (from the start, its journal skipping what is done) and keeps where it ended. What it writes sets no
 * routine or flow off (quietly, as a routine's own changes): a flow that wants to start others sends a signal.
 */
async function execute(...args: Parameters<typeof executeLoud>): Promise<RunResult> {
  const { quietly } = await import("../events");
  return quietly(() => executeLoud(...args));
}

async function executeLoud(runId: number, def: FlowDef, input: Record<string, unknown>, journal: Journal, log: LogEntry[], opts: { dry: boolean; row?: number; trigger?: unknown; resolve?: RunOptions["resolve"] }): Promise<RunResult> {
  const now = new Date();
  const local = `${now.toLocaleDateString("sv-SE")}T${now.toTimeString().slice(0, 5)}`;
  const base: Scope = { input, env: { now: now.toISOString(), local, hour: now.getHours(), weekday: now.getDay(), today: now.toLocaleDateString("sv-SE"), flow: def.name, run: runId, trigger: opts.trigger ?? { kind: "manual" } }, ...(await rowScope(opts.row)) };
  const ctx: Ctx = { runId, flow: def.name, perms: def.permissions, dry: opts.dry, journal, log, steps: {}, vars: {}, base, count: { n: 0, max: def.permissions.maxSteps ?? 500 }, secrets: secretValues(), depth: 0, resolve: opts.resolve };
  try {
    let output: unknown;
    try {
      const last = await runNodes(def.nodes, ctx, "", 0);
      output = def.output !== undefined ? fill(def.output, scopeOf(ctx)) : last;
    } catch (e) {
      if (!(e instanceof Return)) throw e;
      output = e.value;
    }
    output = hideSecrets(output, ctx.secrets);
    saveFlowRun(runId, { status: "done", journal, log, output, waiting: null, wakeAt: null });
    return { runId, status: "done", output, error: null, waiting: null };
  } catch (e) {
    if (e instanceof Suspend) {
      let waiting = e.waiting;
      if (waiting.kind === "ask" || waiting.kind === "approve") {
        // The question goes where all questions to you are (asks.ts): the card shows it; asked again, it replaces the one still open.
        saveFlowRun(runId, { status: "waiting", journal, log, waiting, wakeAt: null });
        const pageId = getFlowRun(runId)?.pageId ?? 0;
        const ask = await askUser({ title: waiting.title ?? "?", text: waiting.text, fields: waiting.fields ?? [], source: { kind: "flow", runId }, from: def.title || def.name, replaceKey: `flow:${pageId}:${waiting.key}`, expiresMinutes: waiting.expiresMinutes });
        waiting = { ...waiting, askId: ask.id };
      }
      saveFlowRun(runId, { status: "waiting", journal, log, waiting, wakeAt: waiting.kind === "wait" ? (waiting.until ?? null) : null });
      return { runId, status: "waiting", output: null, error: null, waiting };
    }
    const error = String(forLog(e instanceof Error ? e.message : String(e), ctx.secrets));
    saveFlowRun(runId, { status: "failed", journal, log, error, waiting: null, wakeAt: null });
    return { runId, status: "failed", output: null, error, waiting: null };
  }
}

/** A flow run with this input (its defaults filled in, the required ones checked). */
export async function runFlow(flow: Flow | string, input: Record<string, unknown> = {}, opts: RunOptions = {}): Promise<RunResult> {
  const f = typeof flow === "string" ? flowByName(flow) : flow;
  if (!f) throw new Error(`There is no flow “${String(flow)}”.`);
  // Safe mode (lib/kernel/safe-mode.ts): nothing starts by itself — a flow by clock or event waits; one you start runs.
  const kind = (opts.trigger as { kind?: string } | undefined)?.kind;
  if ((kind === "schedule" || kind === "event") && (await import("@/lib/kernel/safe-mode")).safeMode()) throw new Error(`Safe mode: the flow “${f.name}” doesn't start by itself.`);
  const def: FlowDef = { name: f.name, title: f.title, inputs: f.inputs, nodes: f.nodes, output: f.output, permissions: f.permissions, triggers: f.triggers, lookup: f.lookup };
  const full = withDefaults(f.inputs, input);
  const runId = startFlowRun({ pageId: f.pageId, name: f.name, def }, opts.trigger ?? { kind: "manual" }, { ...full, ...(opts.row ? { __row: opts.row } : {}) }, !!opts.dry);
  return execute(runId, def, full, {}, [], { dry: !!opts.dry, row: opts.row, trigger: opts.trigger, resolve: opts.resolve });
}

/** A run that waits at a question goes on with its answers (they are kept as that step's output). */
async function continueRun(runId: number, output: Record<string, unknown>, opts: Pick<RunOptions, "resolve"> = {}): Promise<RunResult> {
  const run = getFlowRun(runId);
  if (!run || run.status !== "waiting" || !run.waiting) throw new Error("This run doesn't wait.");
  run.journal[run.waiting.key] = { output, at: new Date().toISOString() };
  run.log.push({ key: run.waiting.key, node: run.waiting.key.split("/").pop()!, kind: run.waiting.kind, status: "ok", ms: 0, output, at: new Date().toISOString(), depth: 0 });
  saveFlowRun(runId, { status: "running", journal: run.journal, log: run.log, waiting: null, wakeAt: null });
  const { __row, ...input } = run.input as Record<string, unknown> & { __row?: number };
  return execute(runId, run.def, input, run.journal, run.log, { dry: run.dry, row: typeof __row === "number" ? __row : undefined, trigger: run.trigger, resolve: opts.resolve });
}

/** A flow's question ended (asks.ts calls it): answered, its run goes on; lapsed or replaced, the run ends. */
export async function flowAskEnded(ask: Ask): Promise<void> {
  if (ask.source.kind !== "flow") return;
  const run = getFlowRun(ask.source.runId);
  if (!run || run.status !== "waiting" || run.waiting?.askId !== ask.id) return;
  if (ask.status === "answered" && ask.answers) await continueRun(run.id, ask.answers);
  else saveFlowRun(run.id, { status: "cancelled", journal: run.journal, log: run.log, error: ask.status === "expired" ? "no answer in time" : "replaced by a newer question, or stopped", waiting: null, wakeAt: null });
}

/** A run that waits for you goes on: its question answered (an approval: its choice and a note). */
export async function resumeFlowRun(runId: number, decision: { choice?: string; note?: string; answers?: Record<string, unknown> }, opts: Pick<RunOptions, "resolve"> = {}): Promise<RunResult> {
  const run = getFlowRun(runId);
  if (!run) throw new Error("There is no such run.");
  if (run.status !== "waiting" || !run.waiting) throw new Error("This run doesn't wait.");
  if (!run.waiting.askId) return continueRun(runId, { ...(decision.answers ?? {}), at: new Date().toISOString() }, opts);
  const answers = decision.answers ?? { choice: decision.choice ?? "", ...(decision.note ? { note: decision.note } : {}) };
  if (run.waiting.kind === "approve" && run.waiting.options?.length && !run.waiting.options.includes(String(answers.choice ?? ""))) throw new Error(`Choose one of ${run.waiting.options.join(", ")}.`);
  await answerAsk(run.waiting.askId, answers);
  const after = getFlowRun(runId)!;
  return { runId, status: after.status, output: after.output, error: after.error, waiting: after.waiting };
}

/** A waiting run stopped. */
export function cancelFlowRun(runId: number): void {
  const run = getFlowRun(runId);
  if (!run || (run.status !== "waiting" && run.status !== "running")) throw new Error("This run is over already.");
  saveFlowRun(runId, { status: "cancelled", journal: run.journal, log: run.log, error: "cancelled", waiting: null, wakeAt: null });
  if (run.waiting?.askId) void cancelAsk(run.waiting.askId);
}

/** The waits that are over go on (the scheduler calls this every minute). */
export async function resumeDueFlows(now = new Date()): Promise<number> {
  // (The questions nobody answered in time lapse: their runs end.)
  let n = await expireAsks(now);
  for (const run of dueRuns(now)) {
    saveFlowRun(run.id, { status: "running", journal: run.journal, log: run.log, waiting: null, wakeAt: null });
    const { __row, ...input } = run.input as Record<string, unknown> & { __row?: number };
    await execute(run.id, run.def, input, run.journal, run.log, { dry: run.dry, row: typeof __row === "number" ? __row : undefined, trigger: run.trigger }).catch((e) => console.error(`[flows] run ${run.id}: ${e instanceof Error ? e.message : e}`));
    n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

export type FlowEvent = { event: "row.added" | "row.changed" | "row.removed" | "signal" | "form.submitted" | "transition"; db?: number; row?: number; field?: string; value?: string; name?: string; payload?: Record<string, unknown> };

let firing = 0;

/** Something happened: the enabled flows that listen run (not while a flow's own event fires another, deeper than 3). */
export async function fireFlowEvent(e: FlowEvent): Promise<number> {
  if (firing > 3) return 0;
  let ran = 0;
  firing++;
  try {
    for (const f of listFlows()) {
      if (f.enabled === false) continue;
      const t = f.triggers.find((x) => x.kind === "event" && x.event === e.event && (!x.db || x.db === e.db) && (!x.field || x.field.toLowerCase() === (e.field ?? "").toLowerCase()) && (!x.equals || x.equals.trim().toLowerCase() === (e.value ?? "").trim().toLowerCase()) && (!x.name || x.name === e.name));
      if (!t) continue;
      try {
        await runFlow(f, { ...(e.payload ?? {}), event: e.event, ...(e.name ? { name: e.name } : {}), ...(e.value !== undefined ? { value: e.value } : {}) }, { trigger: t, row: e.row });
      } catch (err) {
        console.error(`[flows] ${f.name}: ${err instanceof Error ? err.message : err}`);
      }
      ran++;
    }
  } finally {
    firing--;
  }
  return ran;
}

/** When a schedule trigger is due next after `from`: every n minutes (within its hours and days), or at a time on its days. */
export function nextFlowRunAfter(t: { everyMinutes?: number; at?: string; days?: number[]; from?: string; to?: string }, from: Date): Date | null {
  const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  const okDay = (d: Date) => !t.days?.length || t.days.includes(d.getDay());
  if (t.everyMinutes) {
    const lo = t.from ? minutes(t.from) : 0;
    const hi = t.to ? minutes(t.to) : 24 * 60;
    let next = new Date(from.getTime() + t.everyMinutes * 60000);
    for (let i = 0; i < 9; i++) {
      const m = next.getHours() * 60 + next.getMinutes();
      if (okDay(next) && m >= lo && m <= hi) return next;
      // (Outside its hours or days: the start of its hours on the next day that is one of its days.)
      const d = new Date(next);
      if (m > hi || !okDay(next)) d.setDate(d.getDate() + 1);
      d.setHours(Math.floor(lo / 60), lo % 60, 0, 0);
      next = d;
    }
    return null;
  }
  if (!t.at) return null;
  const [h, m] = t.at.split(":").map(Number);
  for (let i = 0; i < 8; i++) {
    const d = new Date(from);
    d.setDate(d.getDate() + i);
    d.setHours(h, m, 0, 0);
    if (d > from && okDay(d)) return d;
  }
  return null;
}

/** The scheduled flows that are due run; the waits that are over go on. */
export async function runDueFlows(now = new Date()): Promise<number> {
  const { setFlowNextRun } = await import("./store");
  let ran = await resumeDueFlows(now);
  for (const f of listFlows()) {
    if (f.enabled === false) continue;
    for (const t of f.triggers) {
      if (t.kind !== "schedule") continue;
      const next = f.nextRunAt ? new Date(f.nextRunAt) : null;
      if (!next) {
        const n = nextFlowRunAfter(t, now);
        setFlowNextRun(f.pageId, n ? n.toISOString() : null);
        continue;
      }
      if (next > now) continue;
      const n = nextFlowRunAfter(t, now);
      setFlowNextRun(f.pageId, n ? n.toISOString() : null);
      await runFlow(f, {}, { trigger: t }).catch((e) => console.error(`[flows] ${f.name}: ${e instanceof Error ? e.message : e}`));
      ran++;
    }
  }
  return ran;
}
