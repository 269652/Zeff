import { workerMcpServers } from "@/lib/work/mcp";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { currentAccountId, withAccount, sharesWorkerSetup } from "@/db/accounts";
import { t } from "@/lib/i18n/server";
import { logPath } from "@/lib/work/log";
import { changed, liveCore, now, reqId, resultOf, sessionsDir, type LiveBase, type LiveCfgBase } from "@/lib/work/live-core";
import { CLAUDE_MODE_INFO, CLAUDE_MODES, isClaudeMode, type AskAnswer, type ClaudeLiveView, type ClaudeMode, type Effort, type SessionMode, type SessionOptions, type WorkResult } from "@/lib/work/shared";
import type { LiveDriver, LiveStart } from "@/lib/work/live-driver";
import { findClaudeCli } from "./cli";
import type { LiveView } from "@/plugins/copilot-cli/live-state";

export { askTitle, hostScript } from "@/lib/work/live-core";

/**
 * Live Claude sessions — Claude Code as you know it, on the Code tab: `claude -p` with stream-json
 * in and out, kept open. It works, it asks you (a permission, its plan, a question) and waits for
 * your answer; you write to it any time (a message sent while it works waits its turn), stop it
 * mid-turn, switch its mode (Ask, Edits, Auto, Plan, Bypass), its model, its effort.
 *
 * The CLI runs outside Zeff's server, so a restart or a deploy doesn't end the session: on the
 * launcher's work host (scripts/work-host.mjs) — or, as administrator (or without the launcher,
 * `npm run dev`), under a host of its own (scripts/work-session-host.mjs). Either way its output
 * goes into the run's log; your messages come back in it (--replay-user-messages); what else Zeff
 * sends (its answers to what it asked, interrupts, mode switches) is kept beside it (log.ts:
 * inPath). A restarted server reads both from the start to know where things stand. What every
 * provider's sessions share (the host, the logs followed, their end) is lib/work/live-core.ts;
 * here is Claude Code's protocol.
 *
 * A session is a conversation (you started it: it waits for you after each turn, until you
 * finish it — then it gives its result — or close it) or a task (Zeff started it for a todo: its
 * turn ending with the result ends it).
 */

/** What a session was started with — kept beside its log (a restarted server reads it). */
export type SessionCfg = LiveCfgBase & {
  elevated: boolean;
  effort: Effort;
  mode: ClaudeMode;
  /** The CLI's arguments, without --resume, --effort, --model and --permission-mode (added per start). */
  args: string[];
  /** The last result taken in at the end of a turn (hash): the run's end doesn't take it in again. */
  appliedResult?: string;
  /** Being restarted (another effort): its exit isn't its end. */
  restarting?: boolean;
  /** The conversation went on from another run's: the first start resumes it. */
  resumeSession?: string | null;
  /** A new conversation's id (the first start creates it so). */
  newSessionId?: string | null;
};

type Live = LiveBase<SessionCfg> & {
  view: ClaudeLiveView;
  mode: string;
  busy: boolean;
  /** Your messages since its last result (more than one: queued). */
  sent: number;
  /** Costs: those of ended processes, and the running one's (cumulative per process). */
  costDone: number;
  costNow: number;
  results: number;
  /** Shell commands (!cmd) to go along with your next message. */
  shell: { cmd: string; out: string; code: number | null }[];
};

const core = liveCore<SessionCfg, Live>({
  keys: { map: "__zeffClaudeLive", runs: "__zeffClaudeLiveRuns", tick: "__zeffClaudeTick" },
  infix: "",
  create: newLive,
  take,
  takeIn,
  busy: (l) => l.busy,
  mode: (l) => l.mode,
  sidebarModes: () => Object.entries(CLAUDE_MODE_INFO).map(([id, m]) => ({ id, name: m.label })),
  detailFields: ["command", "plan", "file_path", "url", "pattern"],
  session: (l) => ({ costUsd: l.costDone + l.costNow, queued: Math.max(0, l.sent - 1), shellPending: l.shell.length }),
  onExit: (l) => {
    l.busy = false;
    l.sent = 0;
  },
  // A conversation's turn with a result: taken in now (todos closed, follow-ups made), the session stays open for you.
  onTurnResult: async (l, turnResult) => {
    const hash = resultHash(turnResult);
    if (hash === l.cfg.appliedResult) return;
    try {
      const { applyTurnResult } = await import("@/lib/work/runner");
      await withAccount(l.account, async () => applyTurnResult(l.runId, turnResult));
      l.cfg.appliedResult = hash;
      core.saveCfg(l);
      changed(true);
    } catch (e) {
      console.error(`[work] taking in the result of run ${l.runId} failed:`, e);
    }
  },
  onExited: (l) => {
    if (!l.cfg.restarting) return false;
    restart(l);
    return true;
  },
  askTimeoutMessage: (min) => `Nobody answered within ${min} min — go on without it, or end with outcome blocked and the question as a follow-up.`,
  answer,
  scrub,
  send: (runId, text) => sendToClaude(runId, text),
});

// Per account (a run's id is its account's): two accounts served side by side never see or steer each other's session.
export const claudeLives = core.lives;

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
export const isClaudeSession = (runId: number) => core.isSession(runId);

export const readSessionCfg = (runId: number): SessionCfg | null => core.readCfg(runId);

/** Claude Code's modes, as the pages offer them (Bypass only when allowed). */
export function claudeModes(allowBypass: boolean): SessionMode[] {
  const tone: Partial<Record<ClaudeMode, SessionMode["tone"]>> = { plan: "info", auto: "warn", bypassPermissions: "danger" };
  return CLAUDE_MODES.filter((m) => m !== "bypassPermissions" || allowBypass).map((m) => ({ id: m, label: CLAUDE_MODE_INFO[m].label, hint: CLAUDE_MODE_INFO[m].hint, tone: tone[m] }));
}

/** The live session as the pages see it (the Copilot-shaped part for the sidebar and attention; the rest under `session`). */
export const claudeLiveView = (runId: number): { live: LiveView; session: ClaudeLiveView } | undefined => core.view(runId);

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
      } else if (e.event === "exit") core.onExit(l);
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

/** Restarted (another effort): resumed where it was. */
function restart(l: Live) {
  l.cfg.restarting = false;
  core.saveCfg(l);
  startProcess(l, true).catch((e) => core.fail(l, e));
}

/**
 * The launcher's work host reports a session's process over (/api/work/exit): true when that's
 * not the run's end — restarting with another effort — else the run is finalized as any.
 */
export function claudeWorkerExited(runId: number): boolean {
  const l = claudeLives.get(runId);
  if (!l || l.closed) return false;
  core.onExit(l);
  if (!l.cfg.restarting) return false;
  restart(l);
  return true;
}

/** A result as a short hash: the same one is taken in once. */
export const resultHash = (r: WorkResult): string => crypto.createHash("sha1").update(JSON.stringify(r)).digest("hex").slice(0, 16);

/** How the session ended, from its log: its result (the last turn's JSON), cost, turns, refusals. For runner.finish. */
export function liveOutcome(runId: number): { result: WorkResult | null; applied: boolean; closed: boolean; lastText: string; costUsd: number | null; turns: number; denials: number; sessionId: string | null } {
  const cfg = readSessionCfg(runId);
  const raw = core.readAll(logPath(runId));
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
  const result = resultOf(lastText);
  return { result, applied: !!result && !!cfg?.appliedResult && cfg.appliedResult === resultHash(result), closed: !!cfg?.closing, lastText, costUsd: cost || null, turns, denials, sessionId };
}

// ——— its process ———

/** What Zeff sent, as kept beside the log: images as their size, not their bytes. */
function scrub(msg: Record<string, unknown>): Record<string, unknown> {
  const content = (msg.message as { content?: unknown } | undefined)?.content;
  return Array.isArray(content)
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
}

function userMessage(text: string, images: Img[] = []) {
  const content: Record<string, unknown>[] = [{ type: "text", text }];
  for (const i of images) content.push({ type: "image", source: { type: "base64", media_type: i.mediaType, data: i.data } });
  return { type: "user", message: { role: "user", content }, parent_tool_use_id: null, session_id: "" };
}

/**
 * Start (or restart: resume) the CLI for a session (live-core: where it runs). `first`: the first
 * message (with the initialize request, the first lines it reads).
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
  await core.launch(l, args, [init, ...(first ? [first] : [])], { retryStarted: true });
}

/** Claude Code's flag for a mode ("default" is "manual" on the command line). */
const cliMode = (m: ClaudeMode) => (m === "default" ? "manual" : m);

function newLive(runId: number, cfg: SessionCfg): Live {
  return {
    ...core.base(runId, cfg, {
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
    }),
    mode: cfg.mode,
    busy: false,
    sent: 0,
    costDone: 0,
    costNow: 0,
    results: 0,
    shell: [],
  };
}

/** A new live session for a run: its config kept, its process started with its first message. */
export async function startClaudeSession(cfg: Omit<SessionCfg, "token">, prompt: string): Promise<void> {
  const full: SessionCfg = { ...cfg, token: crypto.randomBytes(24).toString("hex") };
  fs.mkdirSync(/*turbopackIgnore: true*/ sessionsDir(), { recursive: true });
  fs.mkdirSync(/*turbopackIgnore: true*/ path.dirname(logPath(cfg.runId)), { recursive: true });
  const l = newLive(cfg.runId, full);
  core.saveCfg(l);
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
  core.register(l);
  l.sent++;
  l.busy = true;
  await startProcess(l, false, userMessage(prompt));
}

/**
 * After a server start: the live sessions of the last one — still running on their host — are
 * followed again, their logs read from the start (where things stand); one gone meanwhile ends.
 */
export const reattachClaudeSessions = (runIds: number[]): void => core.reattach(runIds);

// ——— what you do ———

type Img = { mediaType: string; data: string };

/** Your message — with your shell commands since the last one (as Claude Code's ! does), and images. While it works, it waits its turn. */
export async function sendToClaude(runId: number, text: string, images: Img[] = []) {
  const l = core.liveOf(runId);
  if (l.view.host === "down") throw new Error(t("The session is restarting — a moment."));
  const shell = l.shell
    .splice(0)
    .map((s) => `<bash-input>${s.cmd}</bash-input>\n<bash-stdout>${s.out.slice(-20000)}</bash-stdout>${s.code ? `\n<bash-exit-code>${s.code}</bash-exit-code>` : ""}`)
    .join("\n\n");
  await core.write(l, userMessage(shell ? `${shell}\n\n${text}` : text, images));
  l.sent++;
  l.busy = true;
  l.waiting = null;
  changed(true);
}

/** Your answer to what it asks. */
export async function answer(runId: number, requestId: string, a: AskAnswer) {
  const l = core.liveOf(runId);
  const ask = l.view.asks.find((x) => x.requestId === requestId);
  if (!ask) throw new Error(t("It doesn't wait for that any more."));
  let response: Record<string, unknown>;
  if (a.behavior === "allow") {
    const input = a.answers ? { ...ask.input, answers: a.answers } : (a.input ?? ask.input);
    const perms = a.then ? [{ type: "setMode", mode: a.then, destination: "session" }] : a.always ? ask.suggestions : undefined;
    if (a.then && !isClaudeMode(a.then)) throw new Error(t("Unknown mode."));
    if (a.then === "bypassPermissions" && !l.cfg.allowBypass) throw new Error(t("Bypass isn't allowed (Code settings)."));
    response = { behavior: "allow", updatedInput: input, ...(perms?.length ? { updatedPermissions: perms } : {}) };
  } else {
    response = { behavior: "deny", message: a.message?.trim() || "The user said no — don't do that; find another way or ask.", ...(a.interrupt ? { interrupt: true } : {}) };
  }
  await core.write(l, { type: "control_response", response: { subtype: "success", request_id: requestId, response } });
  l.answered.add(requestId);
  l.view.asks = l.view.asks.filter((x) => x.requestId !== requestId);
  changed(true);
}

/** Stop its current turn (what you sent meanwhile is dropped too). */
export async function interruptClaude(runId: number) {
  await core.write(core.liveOf(runId), { type: "control_request", request_id: reqId(), request: { subtype: "interrupt" } });
}

/** Its permission mode, now. */
export async function setClaudeMode(runId: number, mode: string) {
  const l = core.liveOf(runId);
  if (!isClaudeMode(mode)) throw new Error(t("Unknown mode."));
  if (mode === "bypassPermissions" && !l.cfg.allowBypass) throw new Error(t("Bypass isn't allowed — Code settings → “Bypass may be picked” (it applies to new sessions)."));
  await core.write(l, { type: "control_request", request_id: reqId(), request: { subtype: "set_permission_mode", mode } });
  l.mode = mode;
  // What it already waits for is decided by the mode it had when it asked — switched to one that wouldn't ask, those
  // go ahead now (auto, bypass: all; accept edits: the edits). A question for you, its plan: still yours to answer.
  const yours = new Set(["AskUserQuestion", "ExitPlanMode"]);
  const edits = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
  const lets = (tool: string) => !yours.has(tool) && (mode === "auto" || mode === "bypassPermissions" || (mode === "acceptEdits" && edits.has(tool)));
  for (const ask of [...l.view.asks].filter((a) => lets(a.tool))) {
    try {
      await answer(runId, ask.requestId, { behavior: "allow" });
    } catch {
      // answered meanwhile (it doesn't wait for it any more)
    }
  }
  changed();
}

/** Its model, from the next turn on. */
export async function setClaudeModel(runId: number, model: string) {
  await core.setModel(runId, model, (l) => core.write(l, { type: "control_request", request_id: reqId(), request: { subtype: "set_model", model } }));
}

/** Its effort: the CLI takes it only at start — the session restarts (resumed, nothing lost) between turns. */
export async function setClaudeEffort(runId: number, effort: Effort) {
  const l = core.liveOf(runId);
  if (l.busy || l.view.asks.length) throw new Error(t("It's working — change the effort between turns (or stop it first)."));
  if (!l.view.sessionId) throw new Error(t("It hasn't started yet."));
  l.cfg.effort = effort;
  l.view.effort = effort;
  l.cfg.restarting = true;
  core.saveCfg(l);
  await core.stopProcess(l);
  changed();
}

/** Finish: it's asked for its result now — that ends the run (and books it, ticks off its todo …). */
export const finishClaude = (runId: number) => core.finish(runId);

/** Close: end the session without a result (nothing ticked off, nothing booked). */
export const closeClaude = (runId: number) => core.close(runId);

/** Stop it hard (Stop): the CLI and everything it started. */
export const killClaude = (runId: number) => core.kill(runId);

/** A live session that waits for you (not working, nothing asked): it doesn't hold a worker. */
export const claudeIdle = (runId: number): boolean => core.idle(runId);

/**
 * A command in the session's folder (Claude Code's !): its output goes along with your next
 * message to Claude (and shows there). PowerShell on Windows, bash elsewhere. At most 10 minutes.
 */
export async function runShell(runId: number, cmd: string): Promise<{ out: string; code: number | null }> {
  const l = core.liveOf(runId);
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
        ...(s.allowedTools?.length ? ["--allowedTools", s.allowedTools.join(",")] : []),
        ...(s.allowBypass ? ["--allow-dangerously-skip-permissions"] : []),
        // External plugins' MCP servers (src/lib/ext): added to the project's and user's own.
        // Zeff's own, of this run's account, with the run's id: start_todo in a session without a ticket moves this session under the todo's ticket.
        "--mcp-config",
        JSON.stringify(workerMcpServers(currentAccountId(), {}, s.runId)),
        // An account that doesn't share this computer's setup: only these — not your settings' or the folder's servers.
        ...(sharesWorkerSetup(currentAccountId()) ? [] : ["--strict-mcp-config"]),
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
