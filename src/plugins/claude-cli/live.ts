import { extWorkerMcpServers } from "@/lib/ext/work";
import { execFile, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { currentAccountId, withAccount } from "@/db/accounts";
import { emitChange } from "@/lib/events";
import { t } from "@/lib/i18n/server";
import { closeOnHost, killOnHost, spawnOnHost, workHostFeatures, writeToHost } from "@/lib/work/host";
import { errPath, inPath, lastJson, logPath, workDir } from "@/lib/work/log";
import { normalizeResult } from "@/lib/work/outcome";
import { CLAUDE_MODE_INFO, CLAUDE_MODES, isClaudeMode, WORK_RESULT_SCHEMA, workRef, type AskAnswer, type ClaudeAsk, type ClaudeLiveView, type ClaudeMode, type Effort, type SessionMode, type SessionOptions, type WorkResult } from "@/lib/work/shared";
import type { LiveDriver, LiveStart } from "@/lib/work/live-driver";
import { findClaudeCli } from "./cli";
import type { LiveView } from "@/plugins/copilot-cli/live-state";

/**
 * Live Claude sessions — Claude Code as you know it, on the Work tab: `claude -p` with stream-json
 * in and out, kept open. It works, it asks you (a permission, its plan, a question) and waits for
 * your answer; you write to it any time (a message sent while it works waits its turn), stop it
 * mid-turn, switch its mode (Ask, Edits, Auto, Plan, Bypass), its model, its effort.
 *
 * The CLI runs outside Zeff's server, so a restart or a deploy doesn't end the session: on the
 * launcher's work host (scripts/work-host.mjs) — or, as administrator (or without the launcher,
 * `npm run dev`), under a host of its own (scripts/work-session-host.mjs). Either way its output
 * goes into the run's log; your messages come back in it (--replay-user-messages); what else Zeff
 * sends (its answers to what it asked, interrupts, mode switches) is kept beside it (log.ts:
 * inPath). A restarted server reads both from the start to know where things stand.
 *
 * A session is a conversation (you started it: it waits for you after each turn, until you
 * finish it — then it gives its result — or close it) or a task (Zeff started it for a todo: its
 * turn ending with the result ends it).
 */

/** Where the CLI runs: the launcher's work host, or a host of its own (administrator, no launcher). */
type Transport = "launcher" | "own";

/** What a session was started with — kept beside its log (a restarted server reads it). */
export type SessionCfg = {
  runId: number;
  conversation: boolean;
  elevated: boolean;
  effort: Effort;
  model: string | null;
  mode: ClaudeMode;
  allowBypass: boolean;
  askTimeoutMin: number;
  command: string;
  /** The CLI's arguments, without --resume, --effort, --model and --permission-mode (added per start). */
  args: string[];
  cwd: string;
  /** Where it runs now, and (own host) the token Zeff talks to it with / (launcher) its pid. */
  transport?: Transport;
  token: string;
  pid?: number | null;
  /** Asked for its result (finish): its next result ends the run. */
  finishing?: boolean;
  /** Closed by you without a result. */
  closing?: boolean;
  /** Being restarted (another effort): its exit isn't its end. */
  restarting?: boolean;
  /** The conversation went on from another run's: the first start resumes it. */
  resumeSession?: string | null;
  /** A new conversation's id (the first start creates it so). */
  newSessionId?: string | null;
};

type HostInfo = { pid: number; childPid: number | null; port: number; elevated?: boolean };

type Live = {
  runId: number;
  account: string;
  files: { log: string; err: string; in: string; info: string; cfg: string; host: string };
  cfg: SessionCfg;
  /** Read so far: the log and the side log. */
  offset: number;
  rest: string;
  inOffset: number;
  inRest: string;
  /** Answered (by Zeff's side log): asks that are no longer open. */
  answered: Set<string>;
  sock: net.Socket | null;
  connecting: Promise<net.Socket> | null;
  view: ClaudeLiveView;
  mode: string;
  busy: boolean;
  /** What it said this turn, and what it said last (when it waits for you). */
  turnText: string;
  waiting: string | null;
  /** Your messages since its last result (more than one: queued). */
  sent: number;
  /** Costs: those of ended processes, and the running one's (cumulative per process). */
  costDone: number;
  costNow: number;
  results: number;
  /** A result arrived since the last check: maybe the end. */
  resultSeen: boolean;
  exited: boolean;
  /** Shell commands (!cmd) to go along with your next message. */
  shell: { cmd: string; out: string; code: number | null }[];
  /** Waiting for its process to come up (since). */
  startingSince: number | null;
  closed: boolean;
  /** Ticks its process was found gone without an end of its own (killed). */
  missing: number;
  ticks: number;
  stopSent: boolean;
  /** Its logs read up to their end once (after a restart: until then, where it stands isn't known). */
  caughtUp: boolean;
};

const state = globalThis as { __zeffClaudeLive?: Map<number, Live>; __zeffClaudeTick?: ReturnType<typeof setInterval> };
export const claudeLives = (state.__zeffClaudeLive ??= new Map<number, Live>());

const now = () => new Date().toISOString();
const sessionsDir = () => path.join(workDir(), "sessions");
const filesOf = (runId: number) => ({
  log: logPath(runId),
  err: errPath(runId),
  in: inPath(runId),
  cfg: path.join(sessionsDir(), `${runId}.json`),
  host: path.join(sessionsDir(), `${runId}.host-cfg.json`),
  info: path.join(sessionsDir(), `${runId}.host.json`),
});

/** The script a session's own host runs (Zeff's checkout). */
export const hostScript = () => path.join(/*turbopackIgnore: true*/ process.cwd(), "scripts", "work-session-host.mjs");

/** A run's session choices from the composer, kept from dispatch till it starts (queued meanwhile). */
export type SessionOpts = SessionOptions & { conversation: boolean };
const optsFile = (runId: number) => path.join(sessionsDir(), `${runId}.opts.json`);
export function saveSessionOpts(runId: number, opts: SessionOpts): void {
  fs.mkdirSync(/*turbopackIgnore: true*/ sessionsDir(), { recursive: true });
  fs.writeFileSync(/*turbopackIgnore: true*/ optsFile(runId), JSON.stringify(opts));
}
/** A live session's choices (none: not a live Claude session). */
export function readSessionOpts(runId: number): SessionOpts | null {
  try {
    return JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ optsFile(runId), "utf8")) as SessionOpts;
  } catch {
    return null;
  }
}

/** This run is (or was) a live Claude session. */
export const isClaudeSession = (runId: number) => fs.existsSync(/*turbopackIgnore: true*/ filesOf(runId).cfg);

export function readSessionCfg(runId: number): SessionCfg | null {
  try {
    return JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ filesOf(runId).cfg, "utf8")) as SessionCfg;
  } catch {
    return null;
  }
}

function saveCfg(live: Live) {
  fs.writeFileSync(/*turbopackIgnore: true*/ live.files.cfg, JSON.stringify(live.cfg, null, 1));
}

function readInfo(file: string): HostInfo | null {
  try {
    return JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ file, "utf8")) as HostInfo;
  } catch {
    return null;
  }
}

function alive(pid: number | null | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM"; // there — someone else's (an elevated host)
  }
}

function changed(alsoAttention = false) {
  emitChange("work");
  if (alsoAttention) emitChange("attention");
}

/** Claude Code's modes, as the pages offer them (Bypass only when allowed). */
export function claudeModes(allowBypass: boolean): SessionMode[] {
  const tone: Partial<Record<ClaudeMode, SessionMode["tone"]>> = { plan: "info", auto: "warn", bypassPermissions: "danger" };
  return CLAUDE_MODES.filter((m) => m !== "bypassPermissions" || allowBypass).map((m) => ({ id: m, label: CLAUDE_MODE_INFO[m].label, hint: CLAUDE_MODE_INFO[m].hint, tone: tone[m] }));
}

/** The live session as the pages see it (the Copilot-shaped part for the sidebar and attention; the rest under `session`). */
export function claudeLiveView(runId: number): { live: LiveView; session: ClaudeLiveView } | undefined {
  const l = claudeLives.get(runId);
  if (!l || l.closed) return undefined;
  const ask = l.view.asks[0];
  const live: LiveView = {
    mode: l.mode,
    modes: Object.entries(CLAUDE_MODE_INFO).map(([id, m]) => ({ id, name: m.label })),
    busy: l.busy || !!ask || l.view.host === "starting" || !l.caughtUp,
    permission: ask ? { title: askTitle(ask), detail: askDetail(ask), options: [] } : null,
    waiting: !l.busy && !ask && l.view.host !== "starting" && l.caughtUp ? (l.waiting ?? "") : null,
  };
  return { live, session: { ...l.view, asks: [...l.view.asks], costUsd: l.costDone + l.costNow, queued: Math.max(0, l.sent - 1), shellPending: l.shell.length } };
}

/** What it asks, in a few words. */
export function askTitle(a: ClaudeAsk): string {
  if (a.tool === "ExitPlanMode") return t("Its plan — go ahead?");
  if (a.tool === "AskUserQuestion") return t("A question for you");
  return `${a.tool}${a.description ? `: ${a.description}` : ""}`;
}
function askDetail(a: ClaudeAsk): string | null {
  const i = a.input;
  const s = (k: string) => (typeof i[k] === "string" ? (i[k] as string) : "");
  if (a.tool === "AskUserQuestion") return ((i.questions as { question?: string }[] | undefined) ?? []).map((q) => q.question).join(" · ");
  return (s("command") || s("plan") || s("file_path") || s("url") || s("pattern") || JSON.stringify(i)).slice(0, 600);
}

// ——— the logs, followed ———

type Ev = Record<string, unknown> & { type?: string; subtype?: string };

/** Its cost so far: cumulative per process — a new process starts at 0 again (a restart, a new effort). */
function addCost(l: Live, total: number) {
  if (total < l.costNow) l.costDone += l.costNow;
  l.costNow = total;
}

/** One line of the log, into the session's state. */
function take(l: Live, line: string) {
  let e: Ev;
  try {
    e = JSON.parse(line) as Ev;
  } catch {
    return;
  }
  const v = l.view;
  switch (e.type) {
    case "zeff_host":
      // Its own host (administrator, no launcher): when it started and ended.
      if (e.event === "start") {
        l.exited = false;
        v.host = "up";
        l.startingSince = null;
        v.elevated = !!e.elevated;
      } else if (e.event === "exit") onExit(l);
      return;
    case "control_request": {
      const r = (e.request ?? {}) as { subtype?: string; tool_name?: string; input?: Record<string, unknown>; description?: string; decision_reason?: string; permission_suggestions?: unknown[] };
      if (r.subtype !== "can_use_tool" || typeof e.request_id !== "string" || l.answered.has(e.request_id)) return;
      v.asks.push({
        requestId: e.request_id,
        tool: r.tool_name ?? "?",
        input: r.input ?? {},
        description: r.description ?? null,
        reason: r.decision_reason ?? null,
        suggestions: Array.isArray(r.permission_suggestions) ? r.permission_suggestions : [],
        // When it arrived here (a task's unanswered question times out from then).
        at: now(),
      });
      return;
    }
    case "control_response": {
      const r = (e.response ?? {}) as { request_id?: string; subtype?: string; response?: Record<string, unknown> };
      if (r.subtype !== "success" || !r.response) return;
      const models = r.response.models as { value: string; displayName?: string; description?: string; supportedEffortLevels?: string[] }[] | undefined;
      if (Array.isArray(models)) v.models = models.map((m) => ({ value: m.value, label: m.displayName ?? m.value, efforts: m.supportedEffortLevels ?? [] }));
      const commands = r.response.commands as { name: string; description?: string; argumentHint?: string }[] | undefined;
      if (Array.isArray(commands)) v.commands = commands.map((c) => ({ name: c.name, description: (c.description ?? "").slice(0, 200), hint: c.argumentHint ?? "" }));
      if (typeof r.response.mode === "string") l.mode = r.response.mode;
      return;
    }
    case "system":
      if (e.subtype === "init") {
        v.host = "up";
        l.startingSince = null;
        v.sessionId = typeof e.session_id === "string" ? e.session_id : v.sessionId;
        v.model = typeof e.model === "string" ? e.model : v.model;
        if (typeof e.permissionMode === "string") l.mode = e.permissionMode;
        if (!v.commands.length && Array.isArray(e.slash_commands)) v.commands = (e.slash_commands as string[]).map((n) => ({ name: n, description: "", hint: "" }));
      } else if (e.subtype === "status" && typeof e.permissionMode === "string") l.mode = e.permissionMode;
      return;
    case "user":
      // Your message, as the CLI took it in (--replay-user-messages): a turn begins.
      if (e.isReplay) {
        l.busy = true;
        l.waiting = null;
        l.turnText = "";
      }
      return;
    case "assistant": {
      l.busy = true;
      const content = (e.message as { content?: { type: string; text?: string }[] } | undefined)?.content;
      for (const b of Array.isArray(content) ? content : []) if (b.type === "text" && b.text) l.turnText += `${l.turnText ? "\n\n" : ""}${b.text}`;
      return;
    }
    case "result": {
      l.results++;
      l.sent = Math.max(0, l.sent - 1);
      l.busy = l.sent > 0;
      if (typeof e.total_cost_usd === "number") addCost(l, e.total_cost_usd);
      l.waiting = l.turnText.trim().slice(-1500) || (typeof e.result === "string" ? e.result.slice(-1500) : "") || null;
      l.resultSeen = true;
      return;
    }
  }
}

/** One line of Zeff's side log: an answer given — that ask is closed. */
function takeIn(l: Live, line: string) {
  try {
    const m = (JSON.parse(line) as { msg?: { type?: string; response?: { request_id?: string } } }).msg;
    const id = m?.type === "control_response" ? m.response?.request_id : undefined;
    if (id) {
      l.answered.add(id);
      l.view.asks = l.view.asks.filter((a) => a.requestId !== id);
    }
  } catch {
    // half written
  }
}

/** A file's new whole lines from where it was read. */
function newLines(file: string, at: { offset: number; rest: string }): string[] | null {
  let size: number;
  try {
    size = fs.statSync(/*turbopackIgnore: true*/ file).size;
  } catch {
    return null;
  }
  if (size <= at.offset) return null;
  const fd = fs.openSync(/*turbopackIgnore: true*/ file, "r");
  try {
    const buf = Buffer.alloc(Math.min(size - at.offset, 32 * 1024 * 1024));
    const n = fs.readSync(fd, buf, 0, buf.length, at.offset);
    at.offset += n;
    at.rest += buf.subarray(0, n).toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
  const out: string[] = [];
  let i: number;
  while ((i = at.rest.indexOf("\n")) >= 0) {
    const line = at.rest.slice(0, i).trim();
    at.rest = at.rest.slice(i + 1);
    if (line) out.push(line);
  }
  return out;
}

/** The logs' new lines, then what follows from them. */
function follow(l: Live) {
  const asksBefore = l.view.asks.length;
  const busyBefore = l.busy;
  // The side log first: an answer known before its question is read again (after a restart).
  const inPos = { offset: l.inOffset, rest: l.inRest };
  const ins = newLines(l.files.in, inPos);
  l.inOffset = inPos.offset;
  l.inRest = inPos.rest;
  for (const line of ins ?? []) takeIn(l, line);
  const pos = { offset: l.offset, rest: l.rest };
  const lines = newLines(l.files.log, pos);
  l.offset = pos.offset;
  l.rest = pos.rest;
  for (const line of lines ?? []) take(l, line);
  if (!lines && !l.caughtUp) {
    l.caughtUp = true;
    changed();
  }
  if (lines || ins) {
    changed(asksBefore !== l.view.asks.length || busyBefore !== l.busy);
    void settle(l);
  } else if (++l.ticks % 5 === 0) void settle(l);
}

/** Its process ended (its own host said so in the log, or the launcher's reported it): a restart, or its end. */
function onExit(l: Live) {
  l.exited = true;
  l.view.host = "down";
  l.busy = false;
  l.sent = 0;
  l.view.asks = [];
  l.sock?.destroy();
  l.sock = null;
}

/** After new lines: its end (a result for a task, an asked-for result, its process gone), a restart, questions nobody answered. */
async function settle(l: Live) {
  if (l.closed) return;
  const { getRun } = await import("@/lib/work/store");
  const run = getRun(l.runId);
  if (!run || run.status !== "running") {
    // Stopped or finished meanwhile: its process goes too.
    if (!l.exited && !l.stopSent) {
      l.stopSent = true;
      void stopProcess(l);
    }
    if (l.exited || l.missing > 5) drop(l);
    else if (!processAlive(l)) l.missing++;
    return;
  }
  if (l.resultSeen && !l.busy) {
    l.resultSeen = false;
    const ended = !l.cfg.conversation || l.cfg.finishing;
    if (ended && resultOf(l.turnText)) {
      await end(l);
      return;
    }
  }
  if (l.exited) {
    if (l.cfg.restarting) {
      l.cfg.restarting = false;
      saveCfg(l);
      startProcess(l, true).catch((e) => fail(l, e));
      return;
    }
    await end(l);
    return;
  }
  // Its process gone without an end of its own (killed): a few ticks (a normal end comes in meanwhile), then the end.
  l.missing = l.startingSince === null && l.view.host === "up" && !processAlive(l) ? l.missing + 1 : 0;
  if (l.missing > (l.cfg.transport === "launcher" ? 75 : 5)) {
    l.exited = true;
    await end(l, true);
    return;
  }
  // A task's question nobody answers: refused after a while, so the run goes on.
  if (!l.cfg.conversation && l.cfg.askTimeoutMin > 0) {
    const limit = Date.now() - l.cfg.askTimeoutMin * 60000;
    for (const a of l.view.asks.filter((x) => Date.parse(x.at) < limit)) {
      void answer(l.runId, a.requestId, { behavior: "deny", message: `Nobody answered within ${l.cfg.askTimeoutMin} min — go on without it, or end with outcome blocked and the question as a follow-up.` }).catch(() => {});
    }
  }
  // A process that never came up (UAC declined, the task failed, the host refused).
  if (l.startingSince !== null && Date.now() - l.startingSince > (l.cfg.elevated ? 180000 : 60000) && !processAlive(l)) {
    l.startingSince = null;
    fail(l, new Error(l.cfg.elevated ? t("The administrator session didn't start (UAC declined, or the Admin sessions task failed).") : t("The session didn't start.")));
  }
}

/** Its process there: on the launcher's host (its pid), or its own host (its info file and pid). */
function processAlive(l: Live): boolean {
  if (l.cfg.transport === "launcher") return alive(l.cfg.pid);
  const info = readInfo(l.files.info);
  return !!info && (info.elevated || alive(info.pid));
}

/** Its result in what it said: the last ```json block (or object) that is one. */
function resultOf(text: string): WorkResult | null {
  return normalizeResult(lastJson(text));
}

function fail(l: Live, e: unknown) {
  fs.appendFileSync(/*turbopackIgnore: true*/ l.files.err, `${e instanceof Error ? e.message : String(e)}\n`);
  l.exited = true;
  void end(l, true);
}

/** The run taken in (finalize reads the log); its process told to go. */
async function end(l: Live, gone = false) {
  if (l.closed) return;
  l.closed = true;
  const { finalize } = await import("@/lib/work/runner");
  await withAccount(l.account, () => finalize(l.runId, gone && !l.cfg.closing));
  if (!l.exited) await stopProcess(l);
  drop(l);
}

function drop(l: Live) {
  l.closed = true;
  l.sock?.destroy();
  claudeLives.delete(l.runId);
  fs.rmSync(/*turbopackIgnore: true*/ l.files.host, { force: true });
  changed(true);
}

/**
 * The launcher's work host reports a session's process over (/api/work/exit): true when that's
 * not the run's end — restarting with another effort — else the run is finalized as any.
 */
export function claudeWorkerExited(runId: number): boolean {
  const l = claudeLives.get(runId);
  if (!l || l.closed) return false;
  onExit(l);
  if (!l.cfg.restarting) return false;
  l.cfg.restarting = false;
  saveCfg(l);
  startProcess(l, true).catch((e) => fail(l, e));
  return true;
}

/** How the session ended, from its log: its result (the last turn's JSON), cost, turns, refusals. For runner.finish. */
export function liveOutcome(runId: number): { result: WorkResult | null; closed: boolean; lastText: string; costUsd: number | null; turns: number; denials: number; sessionId: string | null } {
  const cfg = readSessionCfg(runId);
  let raw = "";
  try {
    raw = fs.readFileSync(/*turbopackIgnore: true*/ logPath(runId), "utf8");
  } catch {
    // no log
  }
  let turn = "";
  let lastText = "";
  let costDone = 0;
  let costNow = 0;
  let turns = 0;
  let denials = 0;
  let sessionId: string | null = null;
  for (const line of raw.split("\n")) {
    if (!line.startsWith("{")) continue;
    let e: Ev;
    try {
      e = JSON.parse(line) as Ev;
    } catch {
      continue;
    }
    if (e.type === "user" && e.isReplay) turn = "";
    else if (e.type === "assistant") {
      const content = (e.message as { content?: { type: string; text?: string }[] } | undefined)?.content;
      for (const b of Array.isArray(content) ? content : []) if (b.type === "text" && b.text) turn += `${turn ? "\n\n" : ""}${b.text}`;
    } else if (e.type === "result") {
      turns++;
      if (typeof e.total_cost_usd === "number") {
        if (e.total_cost_usd < costNow) costDone += costNow;
        costNow = e.total_cost_usd;
      }
      denials += Array.isArray(e.permission_denials) ? e.permission_denials.length : 0;
      if (typeof e.session_id === "string") sessionId = e.session_id;
      if (turn.trim()) lastText = turn.trim();
    } else if (e.type === "system" && e.subtype === "init" && typeof e.session_id === "string") sessionId = e.session_id;
  }
  const cost = costDone + costNow;
  return { result: resultOf(lastText), closed: !!cfg?.closing, lastText, costUsd: cost || null, turns, denials, sessionId };
}

// ——— its process: on the launcher's work host, or a host of its own ———

function connect(l: Live): Promise<net.Socket> {
  if (l.sock && !l.sock.destroyed) return Promise.resolve(l.sock);
  if (l.connecting) return l.connecting;
  l.connecting = (async () => {
    // The host up (its info file) — an admin one may wait on UAC a while.
    const until = Date.now() + (l.cfg.elevated ? 180000 : 45000);
    let info = readInfo(l.files.info);
    while (!info && Date.now() < until && !l.exited) {
      await new Promise((r) => setTimeout(r, 300));
      info = readInfo(l.files.info);
    }
    if (!info) throw new Error(t("The session isn't running (any more)."));
    const sock = await new Promise<net.Socket>((resolve, reject) => {
      const s = net.connect({ host: "127.0.0.1", port: info.port });
      let buf = "";
      const timer = setTimeout(() => {
        s.destroy();
        reject(new Error(t("The session's host doesn't answer.")));
      }, 5000);
      s.setEncoding("utf8");
      s.once("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      s.on("data", function ok(d) {
        buf += d;
        if (!buf.includes("\n")) return;
        clearTimeout(timer);
        s.off("data", ok);
        if (buf.startsWith("ok")) resolve(s);
        else reject(new Error(t("The session's host refused Zeff.")));
      });
      s.on("connect", () => s.write(`${l.cfg.token}\n`));
    });
    sock.on("error", () => {});
    sock.on("close", () => {
      if (l.sock === sock) l.sock = null;
    });
    l.sock = sock;
    return sock;
  })().finally(() => {
    l.connecting = null;
  });
  return l.connecting;
}

/** One line to its own host (a message for the CLI, or one for the host: stop, kill). */
async function hostSend(l: Live, msg: Record<string, unknown>) {
  const s = await connect(l);
  await new Promise<void>((resolve, reject) => s.write(`${JSON.stringify(msg)}\n`, (e) => (e ? reject(e) : resolve())));
}

/** What Zeff sent, kept beside the log (images as their size, not their bytes). */
function keep(l: Live, msg: Record<string, unknown>) {
  const content = (msg.message as { content?: unknown } | undefined)?.content;
  const scrubbed = Array.isArray(content)
    ? {
        ...msg,
        message: {
          ...(msg.message as object),
          content: content.map((b: { type?: string; source?: { type?: string; media_type?: string; data?: string } }) =>
            b?.type === "image" && b.source?.data ? { type: "image", source: { type: b.source.type, media_type: b.source.media_type, bytes: Math.round((b.source.data.length * 3) / 4) } } : b,
          ),
        },
      }
    : msg;
  fs.appendFileSync(/*turbopackIgnore: true*/ l.files.in, `${JSON.stringify({ type: "zeff_in", at: now(), msg: scrubbed })}\n`);
}

/** One stream-json line to the CLI — kept beside the log, then sent where it runs. */
async function write(l: Live, msg: Record<string, unknown>) {
  keep(l, msg);
  if (l.cfg.transport === "launcher") await writeToHost(l.runId, JSON.stringify(msg));
  else await hostSend(l, msg);
}

/** Its input ended: it finishes and quits. */
async function stopProcess(l: Live) {
  if (l.cfg.transport === "launcher") await closeOnHost(l.runId);
  else await hostSend(l, { zeffHost: "stop" }).catch(() => {});
}

let nextReq = 0;
const reqId = () => `zeff-${Date.now().toString(36)}-${++nextReq}`;

function userMessage(text: string, images: Img[] = []) {
  const content: Record<string, unknown>[] = [{ type: "text", text }];
  for (const i of images) content.push({ type: "image", source: { type: "base64", media_type: i.mediaType, data: i.data } });
  return { type: "user", message: { role: "user", content }, parent_tool_use_id: null, session_id: "" };
}

/**
 * Start (or restart: resume) the CLI for a session — as administrator under its own elevated
 * host, else on the launcher's work host, else (no launcher) under a host of its own. `first`:
 * the first message (with the initialize request, the first lines it reads).
 */
async function startProcess(l: Live, resume: boolean, first?: Record<string, unknown>) {
  const args = [...l.cfg.args];
  const session = resume ? l.view.sessionId : l.cfg.resumeSession;
  if (session) args.push("--resume", session);
  else if (l.cfg.newSessionId) args.push("--session-id", l.cfg.newSessionId);
  if (l.cfg.model) args.push("--model", l.cfg.model);
  if (l.cfg.effort) args.push("--effort", l.cfg.effort);
  // On a restart: the mode it was in.
  args.push("--permission-mode", resume && isClaudeMode(l.mode) ? cliMode(l.mode) : cliMode(l.cfg.mode));
  const init = { type: "control_request", request_id: reqId(), request: { subtype: "initialize" } };
  l.view.host = "starting";
  l.startingSince = Date.now();
  l.exited = false;
  changed();
  const { workerEnv } = await import("@/lib/work/runner");
  // The launcher's host — when its code knows live sessions (one started before an update doesn't, till it restarts).
  const features = l.cfg.elevated ? null : await workHostFeatures();
  if (features?.includes("keep") && features.includes("write")) {
    l.cfg.transport = "launcher";
    const lines = [init, ...(first ? [first] : [])];
    for (const m of lines) keep(l, m);
    // Right after its last process ended, the host may still be reporting it: a moment, then again.
    for (let i = 0; ; i++) {
      try {
        l.cfg.pid = await spawnOnHost({
          runId: l.runId,
          account: l.account,
          command: l.cfg.command,
          args,
          cwd: l.cfg.cwd,
          env: workerEnv(l.runId, true),
          stdin: "",
          stdinLines: lines.map((m) => JSON.stringify(m)),
          outFile: l.files.log,
          errFile: l.files.err,
          live: true,
          keep: true,
        });
        break;
      } catch (e) {
        if (i >= 20 || !/started already/.test(String(e))) throw e;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    saveCfg(l);
    const { updateRun } = await import("@/lib/work/store");
    updateRun(l.runId, { pid: l.cfg.pid });
    return;
  }
  // A host of its own: its config (the token Zeff talks to it with), started detached — or elevated.
  l.cfg.transport = "own";
  saveCfg(l);
  const hostCfg = { command: l.cfg.command, args, cwd: l.cfg.cwd, log: l.files.log, err: l.files.err, info: l.files.info, token: l.cfg.token, elevated: l.cfg.elevated };
  fs.writeFileSync(/*turbopackIgnore: true*/ l.files.host, JSON.stringify(hostCfg));
  fs.rmSync(/*turbopackIgnore: true*/ l.files.info, { force: true });
  if (l.cfg.elevated) {
    const { startElevatedHost } = await import("@/plugins/work-elevated/elevate");
    await startElevatedHost(l.files.host);
  } else {
    if (!fs.existsSync(/*turbopackIgnore: true*/ hostScript())) throw new Error(t("The session host is missing: {path} (Zeff runs from {cwd}).", { path: hostScript(), cwd: process.cwd() }));
    // What goes wrong starting it (node's own errors) into the run's error output.
    const err = fs.openSync(/*turbopackIgnore: true*/ l.files.err, "a");
    // --detach: the host starts itself once more and this one goes — out of the server's process tree.
    const child = spawn(/*turbopackIgnore: true*/ process.execPath, [hostScript(), l.files.host, "--detach"], { cwd: l.cfg.cwd, env: workerEnv(l.runId, true) as NodeJS.ProcessEnv, detached: true, stdio: ["ignore", "ignore", err], windowsHide: true });
    fs.closeSync(err);
    child.on("error", (e) => fail(l, e));
    child.on("exit", (code) => code && fail(l, new Error(t("The session host didn't start (exit {code}) — see above.", { code }))));
    child.unref();
  }
  await write(l, init);
  if (first) await write(l, first);
}

/** Claude Code's flag for a mode ("default" is "manual" on the command line). */
const cliMode = (m: ClaudeMode) => (m === "default" ? "manual" : m);

function newLive(runId: number, cfg: SessionCfg): Live {
  return {
    runId,
    account: currentAccountId(),
    files: filesOf(runId),
    cfg,
    offset: 0,
    rest: "",
    inOffset: 0,
    inRest: "",
    answered: new Set(),
    sock: null,
    connecting: null,
    view: {
      provider: "claude",
      modes: claudeModes(cfg.allowBypass),
      features: ["images", "commands", "shell", "effort", "admin"],
      sessionId: cfg.resumeSession ?? null,
      model: cfg.model,
      models: [],
      effort: cfg.effort,
      elevated: cfg.elevated,
      commands: [],
      host: "down",
      conversation: cfg.conversation,
      asks: [],
      queued: 0,
      costUsd: 0,
      shellPending: 0,
      allowBypass: cfg.allowBypass,
    },
    mode: cfg.mode,
    busy: false,
    turnText: "",
    waiting: null,
    sent: 0,
    costDone: 0,
    costNow: 0,
    results: 0,
    resultSeen: false,
    exited: false,
    shell: [],
    startingSince: null,
    closed: false,
    missing: 0,
    ticks: 0,
    stopSent: false,
    caughtUp: false,
  };
}

/** Follow every live session's logs (one timer for all). */
function ensureTick() {
  if (state.__zeffClaudeTick) return;
  state.__zeffClaudeTick = setInterval(() => {
    for (const l of claudeLives.values()) {
      try {
        withAccount(l.account, () => follow(l));
      } catch (e) {
        console.error(`[work] following ${workRef(l.runId)} failed:`, e);
      }
    }
  }, 400);
  state.__zeffClaudeTick.unref?.();
}

/** A new live session for a run: its config kept, its process started with its first message. */
export async function startClaudeSession(cfg: Omit<SessionCfg, "token">, prompt: string): Promise<void> {
  const full: SessionCfg = { ...cfg, token: crypto.randomBytes(24).toString("hex") };
  fs.mkdirSync(/*turbopackIgnore: true*/ sessionsDir(), { recursive: true });
  fs.mkdirSync(/*turbopackIgnore: true*/ path.dirname(logPath(cfg.runId)), { recursive: true });
  const l = newLive(cfg.runId, full);
  saveCfg(l);
  // From the logs' current ends: an earlier run's lines don't belong to this one (new logs anyway).
  const size = (f: string) => {
    try {
      return fs.statSync(/*turbopackIgnore: true*/ f).size;
    } catch {
      return 0;
    }
  };
  l.offset = size(l.files.log);
  l.inOffset = size(l.files.in);
  claudeLives.set(cfg.runId, l);
  ensureTick();
  l.sent++;
  l.busy = true;
  await startProcess(l, false, userMessage(prompt));
}

/**
 * After a server start: the live sessions of the last one — still running on their host — are
 * followed again, their logs read from the start (where things stand); one gone meanwhile ends.
 */
export function reattachClaudeSessions(runIds: number[]): void {
  for (const runId of runIds) {
    if (claudeLives.has(runId)) continue;
    const cfg = readSessionCfg(runId);
    if (!cfg) continue;
    const l = newLive(runId, cfg);
    l.view.host = processAlive(l) ? "up" : "down";
    claudeLives.set(runId, l);
  }
  ensureTick();
}

// ——— what you do ———

const liveOf = (runId: number): Live => {
  const l = claudeLives.get(runId);
  if (!l || l.closed) throw new Error(t("The session isn't running (any more)."));
  return l;
};

type Img = { mediaType: string; data: string };

/** Your message — with your shell commands since the last one (as Claude Code's ! does), and images. While it works, it waits its turn. */
export async function sendToClaude(runId: number, text: string, images: Img[] = []) {
  const l = liveOf(runId);
  if (l.view.host === "down") throw new Error(t("The session is restarting — a moment."));
  const shell = l.shell
    .splice(0)
    .map((s) => `<bash-input>${s.cmd}</bash-input>\n<bash-stdout>${s.out.slice(-20000)}</bash-stdout>${s.code ? `\n<bash-exit-code>${s.code}</bash-exit-code>` : ""}`)
    .join("\n\n");
  await write(l, userMessage(shell ? `${shell}\n\n${text}` : text, images));
  l.sent++;
  l.busy = true;
  l.waiting = null;
  changed(true);
}

/** Your answer to what it asks. */
export async function answer(runId: number, requestId: string, a: AskAnswer) {
  const l = liveOf(runId);
  const ask = l.view.asks.find((x) => x.requestId === requestId);
  if (!ask) throw new Error(t("It doesn't wait for that any more."));
  let response: Record<string, unknown>;
  if (a.behavior === "allow") {
    const input = a.answers ? { ...ask.input, answers: a.answers } : (a.input ?? ask.input);
    const perms = a.then ? [{ type: "setMode", mode: a.then, destination: "session" }] : a.always ? ask.suggestions : undefined;
    if (a.then && !isClaudeMode(a.then)) throw new Error(t("Unknown mode."));
    if (a.then === "bypassPermissions" && !l.cfg.allowBypass) throw new Error(t("Bypass isn't allowed (Work settings)."));
    response = { behavior: "allow", updatedInput: input, ...(perms?.length ? { updatedPermissions: perms } : {}) };
  } else {
    response = { behavior: "deny", message: a.message?.trim() || "The user said no — don't do that; find another way or ask.", ...(a.interrupt ? { interrupt: true } : {}) };
  }
  await write(l, { type: "control_response", response: { subtype: "success", request_id: requestId, response } });
  l.answered.add(requestId);
  l.view.asks = l.view.asks.filter((x) => x.requestId !== requestId);
  changed(true);
}

/** Stop its current turn (what you sent meanwhile is dropped too). */
export async function interruptClaude(runId: number) {
  await write(liveOf(runId), { type: "control_request", request_id: reqId(), request: { subtype: "interrupt" } });
}

/** Its permission mode, now. */
export async function setClaudeMode(runId: number, mode: string) {
  const l = liveOf(runId);
  if (!isClaudeMode(mode)) throw new Error(t("Unknown mode."));
  if (mode === "bypassPermissions" && !l.cfg.allowBypass) throw new Error(t("Bypass isn't allowed — Work settings → “Bypass may be picked” (it applies to new sessions)."));
  await write(l, { type: "control_request", request_id: reqId(), request: { subtype: "set_permission_mode", mode } });
  l.mode = mode;
  changed();
}

/** Its model, from the next turn on. */
export async function setClaudeModel(runId: number, model: string) {
  const l = liveOf(runId);
  if (!/^[\w.[\]-]{1,80}$/.test(model)) throw new Error(t("Unknown model."));
  await write(l, { type: "control_request", request_id: reqId(), request: { subtype: "set_model", model } });
  l.cfg.model = model;
  l.view.model = model;
  saveCfg(l);
  changed();
}

/** Its effort: the CLI takes it only at start — the session restarts (resumed, nothing lost) between turns. */
export async function setClaudeEffort(runId: number, effort: Effort) {
  const l = liveOf(runId);
  if (l.busy || l.view.asks.length) throw new Error(t("It's working — change the effort between turns (or stop it first)."));
  if (!l.view.sessionId) throw new Error(t("It hasn't started yet."));
  l.cfg.effort = effort;
  l.view.effort = effort;
  l.cfg.restarting = true;
  saveCfg(l);
  await stopProcess(l);
  changed();
}

/** Finish: it's asked for its result now — that ends the run (and books it, ticks off its todo …). */
export async function finishClaude(runId: number) {
  const l = liveOf(runId);
  l.cfg.finishing = true;
  saveCfg(l);
  await sendToClaude(
    runId,
    `Schließ jetzt ab: fasse zusammen, was du in dieser Session getan hast, und antworte mit dem Ergebnis als JSON in einem \`\`\`json-Block, nach diesem Schema:\n${JSON.stringify(WORK_RESULT_SCHEMA)}`,
  );
}

/** Close: end the session without a result (nothing ticked off, nothing booked). */
export async function closeClaude(runId: number) {
  const l = liveOf(runId);
  l.cfg.closing = true;
  saveCfg(l);
  if (l.exited) await end(l);
  else await stopProcess(l);
}

/** Stop it hard (Stop): the CLI and everything it started. */
export function killClaude(runId: number) {
  const l = claudeLives.get(runId);
  const cfg = l?.cfg ?? readSessionCfg(runId);
  const files = l?.files ?? filesOf(runId);
  if (cfg?.transport === "launcher") void killOnHost(runId);
  else {
    const info = readInfo(files.info);
    // Over its socket (it kills its CLI's tree and ends) — and, ours (not elevated), its whole tree at once as well.
    if (l && !l.exited) void hostSend(l, { zeffHost: "kill" }).catch(() => {});
    if (info?.pid && !info.elevated && alive(info.pid)) {
      if (process.platform === "win32") execFile("taskkill", ["/PID", String(info.pid), "/T", "/F"], { windowsHide: true }, () => {});
      else
        try {
          process.kill(info.pid, "SIGTERM");
        } catch {
          // gone already
        }
    }
  }
  if (l) l.closed = true;
  claudeLives.delete(runId);
  changed(true);
}

/** A live session that waits for you (not working, nothing asked): it doesn't hold a worker. */
export function claudeIdle(runId: number): boolean {
  const l = claudeLives.get(runId);
  return !!l && !l.closed && l.caughtUp && !l.busy && !l.view.asks.length && l.view.host === "up";
}

/**
 * A command in the session's folder (Claude Code's !): its output goes along with your next
 * message to Claude (and shows there). PowerShell on Windows, bash elsewhere. At most 10 minutes.
 */
export async function runShell(runId: number, cmd: string): Promise<{ out: string; code: number | null }> {
  const l = liveOf(runId);
  const win = process.platform === "win32";
  const { workerEnv } = await import("@/lib/work/runner");
  const res = await new Promise<{ out: string; code: number | null }>((resolve) => {
    const child = spawn(win ? "powershell.exe" : "bash", win ? ["-NoProfile", "-NonInteractive", "-Command", cmd] : ["-lc", cmd], { cwd: l.cfg.cwd, env: workerEnv(l.runId) as NodeJS.ProcessEnv, windowsHide: true });
    let out = "";
    const add = (d: Buffer) => {
      out += d.toString("utf8");
      if (out.length > 400000) out = out.slice(-200000);
    };
    child.stdout.on("data", add);
    child.stderr.on("data", add);
    const timer = setTimeout(() => child.kill(), 600000);
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ out: `${out}${e.message}`, code: -1 });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ out, code });
    });
  });
  l.shell.push({ cmd, ...res });
  changed();
  return res;
}

/** The tools a live session must not use beyond Zeff's: StructuredOutput (a conversation an older one-shot run began knows it — not here: its result is a json block). */
const NOT_HERE = ["StructuredOutput"];

/** Start a live session from what the runner knows: Claude Code's own arguments made here. */
async function startFrom(s: LiveStart): Promise<void> {
  const cli = findClaudeCli();
  if (!cli) throw new Error(t("The Claude CLI wasn't found — install Claude Code, or set CLAUDE_CLI."));
  // CLAUDE_CLI may be a script (a stand-in): run with node.
  const script = /\.(c|m)?js$/i.test(cli);
  await startClaudeSession(
    {
      runId: s.runId,
      conversation: s.conversation,
      elevated: s.elevated,
      effort: s.effort,
      model: s.model,
      mode: isClaudeMode(s.mode) ? s.mode : "default",
      allowBypass: s.allowBypass,
      askTimeoutMin: s.askTimeoutMin,
      command: script ? process.execPath : cli,
      args: [
        ...(script ? [cli] : []),
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--permission-prompt-tool",
        "stdio",
        "--replay-user-messages",
        "--name",
        s.name,
        "--append-system-prompt",
        s.rules,
        "--disallowedTools",
        [...s.disallowedTools, ...NOT_HERE].join(","),
        ...(s.allowBypass ? ["--allow-dangerously-skip-permissions"] : []),
        // External plugins' MCP servers (src/lib/ext): added to the project's and user's own.
        ...(Object.keys(extWorkerMcpServers()).length ? ["--mcp-config", JSON.stringify({ mcpServers: extWorkerMcpServers() })] : []),
      ],
      cwd: s.cwd,
      resumeSession: s.resumeSession,
      newSessionId: s.newSessionId,
    },
    s.prompt,
  );
}

/** Claude Code as a live-session driver (see lib/work/live-driver.ts). */
export const claudeLiveDriver: LiveDriver = {
  provider: "claude",
  assignsSessionId: true,
  modes: ({ allowBypass }) => claudeModes(allowBypass),
  start: startFrom,
  reattach: reattachClaudeSessions,
  has: isClaudeSession,
  runIds: () => [...claudeLives.keys()],
  view: claudeLiveView,
  idle: claudeIdle,
  send: sendToClaude,
  answer,
  interrupt: interruptClaude,
  setMode: setClaudeMode,
  setModel: setClaudeModel,
  setEffort: setClaudeEffort,
  shell: runShell,
  finish: finishClaude,
  close: closeClaude,
  kill: killClaude,
  outcome: liveOutcome,
  workerExited: claudeWorkerExited,
};
