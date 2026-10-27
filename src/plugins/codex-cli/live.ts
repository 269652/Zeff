import { spawn } from "node:child_process";
import { RunMap } from "@/lib/work/run-map";
import crypto from "node:crypto";
import fs from "node:fs";
import type net from "node:net";
import path from "node:path";
import { currentAccountId, withAccount } from "@/db/accounts";
import { killPid } from "@/lib/abort";
import { emitChange } from "@/lib/events";
import { t } from "@/lib/i18n/server";
import { closeOnHost, killOnHost, spawnOnHost, workHostFeatures, writeToHost } from "@/lib/work/host";
import { errPath, inPath, lastJson, logPath, workDir } from "@/lib/work/log";
import { workerMcpServers } from "@/lib/work/mcp";
import { normalizeResult } from "@/lib/work/outcome";
import { connectHost, newLines, pidAlive, readHostInfo } from "@/lib/work/session-host";
import { WORK_RESULT_SCHEMA, workRef, type AskAnswer, type ClaudeAsk, type Effort, type SessionLiveView, type SessionMode, type WorkResult } from "@/lib/work/shared";
import type { LiveDriver, LiveOutcome, LiveStart } from "@/lib/work/live-driver";
import { hostScript } from "@/plugins/claude-cli/live";
import type { LiveView } from "@/plugins/copilot-cli/live-state";
import { codexModels, codexSandboxState, findCodexCli } from "./cli";
import { commandText, fileChangeInput, markCodexRun, type FileUpdate } from "./log";

/**
 * Live Codex sessions (ChatGPT) on the Code tab: `codex app-server`, Codex's own JSON-RPC over
 * stdio (a line each way) — a thread, its turns, what it asks before it runs a command or changes
 * a file, your answers. Like Claude Code's (plugins/claude-cli/live.ts) it runs under a host
 * outside Zeff's server (the launcher's work host, or scripts/work-session-host.mjs), so a
 * restart or a deploy doesn't end it: the host writes what the CLI prints into the run's log,
 * Zeff keeps what it sends beside it (log.ts: inPath) and reads both from the start after a restart.
 *
 * Its thread id is the session's: a later run resumes it (thread/resume). A message sent while it
 * works steers the running turn (turn/steer); one it can't take waits for the next turn.
 */

/** Where the CLI runs: the launcher's work host, or a host of its own. */
type Transport = "launcher" | "own";

/** What a session was started with — kept beside its log (a restarted server reads it). */
type CodexCfg = {
  runId: number;
  conversation: boolean;
  effort: Effort;
  model: string | null;
  mode: string;
  allowBypass: boolean;
  askTimeoutMin: number;
  /** Its runs that only look (no edits allowed): the read-only sandbox, whatever the mode. */
  readOnly: boolean;
  command: string;
  args: string[];
  cwd: string;
  transport?: Transport;
  token: string;
  pid?: number | null;
  /** The first message, till the thread is there to take it (turn/start needs its id). */
  pending: string | null;
  /** The mode was switched: the next turn takes its approval policy and sandbox. */
  policyChanged?: boolean;
  finishing?: boolean;
  closing?: boolean;
  resumeSession: string | null;
};

/** A JSON-RPC message, either way (Codex's: no "jsonrpc" member). */
type Rpc = { id?: string | number; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown>; error?: { code?: number; message?: string } };
/** Codex's user input items (text, a picture on disk). */
type Input = { type: "text"; text: string; text_elements: [] } | { type: "localImage"; path: string };

/** What an open request of the CLI needs for its answer. */
type AskMeta = { rpcId: string | number; method: string; available: unknown[] | null; questions: { id: string; question: string }[]; permissions: Record<string, unknown> | null };

type Live = {
  runId: number;
  account: string;
  files: { log: string; err: string; in: string; info: string; cfg: string; host: string };
  cfg: CodexCfg;
  offset: number;
  rest: string;
  inOffset: number;
  inRest: string;
  /** Zeff's requests by id (what a response answers), and its turn/starts not answered yet. */
  sent: Map<string, { method: string; input?: Input[] }>;
  turnRequests: Set<string>;
  /** The CLI's requests answered (by Zeff's side log, or resolved by the CLI). */
  answered: Set<string>;
  meta: Map<string, AskMeta>;
  /** File changes by item (an approval names the item only). */
  changes: Map<string, FileUpdate[]>;
  sock: net.Socket | null;
  connecting: Promise<net.Socket> | null;
  view: SessionLiveView;
  threadId: string | null;
  turnId: string | null;
  turnText: string;
  waiting: string | null;
  /** Messages for the next turn (sent before the thread was there, or not taken by the running turn). */
  outbox: Input[][];
  /** Stop asked for before the turn had its id: sent once it has. */
  stopWanted: boolean;
  resultSeen: boolean;
  /** Something that ends it (the thread didn't start). */
  fatal: string | null;
  exited: boolean;
  startingSince: number | null;
  closed: boolean;
  missing: number;
  ticks: number;
  stopSent: boolean;
  caughtUp: boolean;
};

// Per account (a run's id is its account's): two accounts served side by side never see or steer each other's session.
const state = globalThis as { __zeffCodexLive?: Map<number, Live>; __zeffCodexLiveRuns?: RunMap<Live>; __zeffCodexTick?: ReturnType<typeof setInterval> };
export const codexLives = (state.__zeffCodexLiveRuns ??= new RunMap<Live>(currentAccountId, state.__zeffCodexLive));

const now = () => new Date().toISOString();
const sessionsDir = () => path.join(workDir(), "sessions");
// (Not <run>.json — that's Claude's: its driver would take the run for its own.)
const filesOf = (runId: number) => ({
  log: logPath(runId),
  err: errPath(runId),
  in: inPath(runId),
  cfg: path.join(sessionsDir(), `${runId}.codex.json`),
  host: path.join(sessionsDir(), `${runId}.codex.host-cfg.json`),
  info: path.join(sessionsDir(), `${runId}.codex.host.json`),
});

/** This run is (or was) a live Codex session. */
export const isCodexSession = (runId: number) => fs.existsSync(/*turbopackIgnore: true*/ filesOf(runId).cfg);

function readCfg(runId: number): CodexCfg | null {
  try {
    return JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ filesOf(runId).cfg, "utf8")) as CodexCfg;
  } catch {
    return null;
  }
}

function saveCfg(l: Live) {
  fs.writeFileSync(/*turbopackIgnore: true*/ l.files.cfg, JSON.stringify(l.cfg, null, 1));
}

function changed(alsoAttention = false) {
  emitChange("work");
  if (alsoAttention) emitChange("attention");
}

// ——— its modes: an approval policy and a sandbox each ———

// (Ids apart from Claude's — "auto" is one of those, and the page shows a Claude mode id as Claude's.)
type Policy = { approval: "untrusted" | "on-request" | "never"; sandbox: "read-only" | "workspace-write" | "danger-full-access" };
const POLICIES: Record<string, Policy> = {
  ask: { approval: "untrusted", sandbox: "workspace-write" },
  agent: { approval: "on-request", sandbox: "workspace-write" },
  "read-only": { approval: "on-request", sandbox: "read-only" },
  full: { approval: "never", sandbox: "danger-full-access" },
};

/** Codex's modes, as the pages offer them (Full access only when allowed); the first is the default. */
export function codexModes(allowBypass: boolean): SessionMode[] {
  // English: the page translates them (this t only marks them for the language bundles).
  const t = (s: string) => s;
  const modes: SessionMode[] = [
    { id: "ask", label: t("Ask"), hint: t("Works in its folder; asks you before every command that isn't a known safe one, and before edits outside it.") },
    {
      id: "agent",
      label: t("Auto"),
      // (Without Codex's Windows sandbox nothing runs "on its own": every command asks, as in Ask.)
      hint: codexSandboxState() === "notConfigured" || codexSandboxState() === "updateRequired"
        ? t("Meant to work in its folder on its own — but Codex's Windows sandbox isn't set up here, so it asks before every command, like Ask.")
        : t("Works in its folder on its own; asks you only when it needs more (the network, other folders)."),
      tone: "warn",
    },
    { id: "read-only", label: t("Read only"), hint: t("Looks around and changes nothing — asks you when it wants to change something.") },
    { id: "full", label: t("Full access"), hint: t("No sandbox, never asks — only where nothing can go wrong."), tone: "danger" },
  ];
  return modes.filter((m) => m.id !== "full" || allowBypass);
}

const policyOf = (l: Live): Policy => {
  const p = POLICIES[l.cfg.mode] ?? POLICIES.ask;
  return l.cfg.readOnly ? { ...p, sandbox: "read-only" } : p;
};

/** A sandbox as turn/start takes it. */
function sandboxPolicy(s: Policy["sandbox"]) {
  if (s === "danger-full-access") return { type: "dangerFullAccess" };
  if (s === "read-only") return { type: "readOnly", networkAccess: false };
  return { type: "workspaceWrite", writableRoots: [], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false };
}

// ——— the view ———

function askTitle(a: ClaudeAsk): string {
  if (a.tool === "AskUserQuestion") return t("A question for you");
  return `${a.tool}${a.description ? `: ${a.description}` : ""}`;
}
function askDetail(a: ClaudeAsk): string | null {
  const i = a.input;
  const s = (k: string) => (typeof i[k] === "string" ? (i[k] as string) : "");
  if (a.tool === "AskUserQuestion") return ((i.questions as { question?: string }[] | undefined) ?? []).map((q) => q.question).join(" · ");
  return (s("command") || s("file_path") || s("url") || s("message") || JSON.stringify(i)).slice(0, 600);
}

const busy = (l: Live) => l.turnId !== null || l.turnRequests.size > 0;

/** The live session as the pages see it (the Copilot-shaped part for the sidebar and attention; the rest under `session`). */
export function codexLiveView(runId: number): { live: LiveView; session: SessionLiveView } | undefined {
  const l = codexLives.get(runId);
  if (!l || l.closed) return undefined;
  const ask = l.view.asks[0];
  const starting = l.view.host === "starting" || !l.threadId;
  const live: LiveView = {
    mode: l.cfg.mode,
    modes: l.view.modes.map((m) => ({ id: m.id, name: m.label })),
    busy: busy(l) || !!ask || starting || !l.caughtUp || !!l.cfg.pending,
    permission: ask ? { title: askTitle(ask), detail: askDetail(ask), options: [] } : null,
    waiting: !busy(l) && !ask && !starting && l.caughtUp && !l.cfg.pending ? (l.waiting ?? "") : null,
  };
  return { live, session: { ...l.view, asks: [...l.view.asks], queued: l.outbox.length, costUsd: null } };
}

/** Waits for you (not working, nothing asked): it doesn't hold a worker. */
export function codexIdle(runId: number): boolean {
  const l = codexLives.get(runId);
  return !!l && !l.closed && l.caughtUp && !busy(l) && !l.view.asks.length && l.view.host === "up" && !!l.threadId && !l.cfg.pending && !l.outbox.length;
}

// ——— the logs, followed ———

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** One line of the log (what the CLI printed), into the session's state. */
function take(l: Live, line: string) {
  let m: Rpc & { type?: string; event?: string };
  try {
    m = JSON.parse(line) as typeof m;
  } catch {
    return;
  }
  if (m.type === "zeff_host") {
    // Its own host: when it started and ended.
    if (m.event === "start") {
      l.exited = false;
      l.view.host = "up";
      l.startingSince = null;
    } else if (m.event === "exit") onExit(l);
    return;
  }
  if (m.method && m.id !== undefined) request(l, m);
  else if (m.method) notification(l, m);
  else if (m.id !== undefined) response(l, m);
}

/** A response to one of Zeff's requests. */
function response(l: Live, m: Rpc) {
  const id = String(m.id);
  const req = l.sent.get(id);
  if (!req) return;
  const r = m.result ?? {};
  switch (req.method) {
    case "thread/start":
    case "thread/resume": {
      if (m.error) {
        l.fatal = t("Codex didn't start the session: {why}", { why: m.error.message ?? "?" });
        return;
      }
      const thread = (r.thread ?? {}) as { id?: string };
      l.threadId = thread.id ?? l.threadId;
      l.view.sessionId = l.threadId;
      if (typeof r.model === "string") l.view.model = l.cfg.model ?? r.model;
      l.view.host = "up";
      l.startingSince = null;
      return;
    }
    case "turn/start":
      l.turnRequests.delete(id);
      if (m.error) l.waiting = t("Codex didn't take the message: {why}", { why: m.error.message ?? "?" });
      else l.turnId ??= ((r.turn ?? {}) as { id?: string }).id ?? null;
      stopIfWanted(l);
      return;
    case "turn/steer":
      // The turn ended meanwhile: the message goes with the next one.
      if (m.error && req.input && l.caughtUp) l.outbox.push(req.input);
      return;
  }
}

/** A notification: the thread, its turns and their items. */
function notification(l: Live, m: Rpc) {
  const p = m.params ?? {};
  const item = (p.item ?? {}) as { type?: string; id?: string; text?: string; changes?: FileUpdate[] };
  switch (m.method) {
    case "thread/started":
      l.threadId ??= ((p.thread ?? {}) as { id?: string }).id ?? null;
      l.view.sessionId = l.threadId;
      return;
    case "turn/started":
      l.turnId = ((p.turn ?? {}) as { id?: string }).id ?? l.turnId;
      l.turnText = "";
      l.waiting = null;
      stopIfWanted(l);
      return;
    case "item/started":
      if (item.type === "fileChange" && item.id) l.changes.set(item.id, item.changes ?? []);
      return;
    case "item/completed":
      if (item.type === "agentMessage" && item.text) l.turnText += `${l.turnText ? "\n\n" : ""}${item.text}`;
      return;
    case "turn/completed": {
      const turn = (p.turn ?? {}) as { id?: string; status?: string; error?: { message?: string } | null };
      if (!l.turnId || turn.id === l.turnId) l.turnId = null;
      // What it asked in that turn is moot now.
      for (const a of l.view.asks) l.answered.add(a.requestId);
      l.view.asks = [];
      l.waiting = l.turnText.trim().slice(-1500) || (turn.status === "failed" ? (turn.error?.message ?? "") : "") || null;
      l.resultSeen = true;
      l.stopWanted = false;
      return;
    }
    case "serverRequest/resolved": {
      const id = String(p.requestId);
      l.answered.add(id);
      l.view.asks = l.view.asks.filter((a) => a.requestId !== id);
      return;
    }
  }
}

/** A request of the CLI: something it asks you — or one Zeff doesn't serve (refused at once). */
function request(l: Live, m: Rpc) {
  const id = String(m.id);
  if (l.answered.has(id)) return;
  const p = m.params ?? {};
  const ask = (tool: string, input: Record<string, unknown>, extra: Partial<ClaudeAsk> = {}, meta: Partial<AskMeta> = {}) => {
    l.meta.set(id, { rpcId: m.id!, method: m.method!, available: Array.isArray(p.availableDecisions) ? p.availableDecisions : null, questions: [], permissions: null, ...meta });
    l.view.asks.push({ requestId: id, tool, input, description: null, reason: str(p.reason) || null, suggestions: [], at: now(), ...extra });
  };
  const available = Array.isArray(p.availableDecisions) ? (p.availableDecisions as unknown[]) : null;
  const offers = (d: string) => !available || available.some((x) => x === d || (!!x && typeof x === "object" && d in x));
  switch (m.method) {
    case "item/commandExecution/requestApproval": {
      const command = commandText(str(p.command), p.commandActions as { command?: string }[]);
      const amendment = Array.isArray(p.proposedExecpolicyAmendment) ? (p.proposedExecpolicyAmendment as string[]).join(" ") : "";
      // "Always" — the rule it proposes, or this command for the session.
      const always = offers("acceptForSession") || offers("acceptWithExecpolicyAmendment");
      ask("Bash", { command, ...(str(p.cwd) ? { cwd: str(p.cwd) } : {}) }, { suggestions: always ? [{ type: "addRules", rules: [{ toolName: "Bash", ruleContent: amendment || command }] }] : [] });
      return;
    }
    case "item/fileChange/requestApproval": {
      const { tool, input } = fileChangeInput(l.changes.get(str(p.itemId)) ?? []);
      ask(tool, input, { suggestions: offers("acceptForSession") ? [{ type: "setMode", mode: "acceptEdits" }] : [] });
      return;
    }
    case "item/tool/requestUserInput": {
      const qs = (p.questions ?? []) as { id: string; header?: string; question: string; options?: { label: string; description?: string }[] | null }[];
      ask(
        "AskUserQuestion",
        { questions: qs.map((q) => ({ question: q.question, header: q.header ?? "", multiSelect: false, options: (q.options ?? []).map((o) => ({ label: o.label, description: o.description ?? "" })) })) },
        {},
        { questions: qs.map((q) => ({ id: q.id, question: q.question })) },
      );
      return;
    }
    case "item/permissions/requestApproval": {
      const permissions = (p.permissions ?? {}) as Record<string, unknown>;
      ask("Permissions", { ...(str(p.cwd) ? { cwd: str(p.cwd) } : {}), ...permissions }, { suggestions: [{ type: "addDirectories", directories: [str(p.cwd)].filter(Boolean) }] }, { permissions });
      return;
    }
    case "mcpServer/elicitation/request":
      ask(`MCP ${str(p.serverName)}`, p.mode === "url" ? { url: str(p.url), message: str(p.message) } : { message: str(p.message) }, { description: str(p.message).slice(0, 200) || null });
      return;
  }
  // Nothing Zeff serves (dynamic tools, sign-in refreshes …): refused, so it doesn't wait.
  if (l.caughtUp) void write(l, { id: m.id, error: { code: -32601, message: `Zeff doesn't serve ${m.method}` } }).catch(() => {});
}

/** One line of Zeff's side log: a request it sent (to know what a response answers), an answer it gave. */
function takeIn(l: Live, line: string) {
  let m: Rpc | undefined;
  try {
    m = (JSON.parse(line) as { msg?: Rpc }).msg;
  } catch {
    return; // half written
  }
  if (m?.id === undefined) return;
  const id = String(m.id);
  if (m.method) {
    const input = m.method === "turn/steer" ? ((m.params?.input ?? []) as Input[]) : undefined;
    l.sent.set(id, { method: m.method, ...(input ? { input } : {}) });
    if (m.method === "turn/start") l.turnRequests.add(id);
  } else {
    l.answered.add(id);
    l.view.asks = l.view.asks.filter((a) => a.requestId !== id);
  }
}

/** The logs' new lines, then what follows from them. */
function follow(l: Live) {
  const asksBefore = l.view.asks.length;
  const busyBefore = busy(l);
  // The side log first: a request's response, an answer's question, are read after it.
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
  if (l.caughtUp && !l.closed) void flush(l).catch((e) => fs.appendFileSync(/*turbopackIgnore: true*/ l.files.err, `${e instanceof Error ? e.message : String(e)}\n`));
  if (lines || ins) {
    changed(asksBefore !== l.view.asks.length || busyBefore !== busy(l));
    void settle(l);
  } else if (++l.ticks % 5 === 0) void settle(l);
}

/** The thread there and nothing under way: the first message, or what waited, as the next turn. */
async function flush(l: Live) {
  if (!l.threadId || busy(l) || l.view.host !== "up" || l.exited) return;
  if (l.cfg.pending !== null) {
    const text = l.cfg.pending;
    l.cfg.pending = null;
    saveCfg(l);
    await startTurn(l, [textInput(text)]);
  } else if (l.outbox.length) await startTurn(l, l.outbox.splice(0).flat());
}

/** Its process ended (its own host said so, or the launcher's reported it). */
function onExit(l: Live) {
  l.exited = true;
  l.view.host = "down";
  l.turnId = null;
  l.turnRequests.clear();
  l.view.asks = [];
  l.sock?.destroy();
  l.sock = null;
}

/** After new lines: its end (a task's result, an asked-for result, its process gone), questions nobody answered. */
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
  if (l.fatal) {
    fail(l, new Error(l.fatal));
    return;
  }
  if (l.resultSeen && !busy(l)) {
    l.resultSeen = false;
    if ((!l.cfg.conversation || l.cfg.finishing) && resultOf(l.turnText)) {
      await end(l);
      return;
    }
  }
  if (l.exited) {
    await end(l);
    return;
  }
  // Its process gone without an end of its own (killed): a few ticks, then the end.
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
      void answer(l.runId, a.requestId, { behavior: "deny", message: `Niemand hat innerhalb von ${l.cfg.askTimeoutMin} Minuten geantwortet — mach ohne weiter, oder schließ mit outcome blocked und der Frage als Follow-up ab.` }).catch(() => {});
    }
  }
  if (l.startingSince !== null && Date.now() - l.startingSince > 60000 && !processAlive(l)) {
    l.startingSince = null;
    fail(l, new Error(t("The session didn't start.")));
  }
}

function processAlive(l: Live): boolean {
  if (l.cfg.transport === "launcher") return pidAlive(l.cfg.pid);
  const info = readHostInfo(l.files.info);
  return !!info && pidAlive(info.pid);
}

const resultOf = (text: string): WorkResult | null => normalizeResult(lastJson(text));

function fail(l: Live, e: unknown) {
  fs.appendFileSync(/*turbopackIgnore: true*/ l.files.err, `${e instanceof Error ? e.message : String(e)}\n`);
  l.exited = l.exited || !processAlive(l);
  void end(l, true);
}

/** The run taken in (finalize reads the log through outcome()); its process told to go. */
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
  codexLives.delete(l.runId, l.account);
  fs.rmSync(/*turbopackIgnore: true*/ l.files.host, { force: true });
  // The pictures you sent it.
  try {
    for (const f of fs.readdirSync(/*turbopackIgnore: true*/ sessionsDir())) if (f.startsWith(`${l.runId}.codex-img-`)) fs.rmSync(/*turbopackIgnore: true*/ path.join(sessionsDir(), f), { force: true });
  } catch {
    // no folder
  }
  changed(true);
}

/** The launcher's work host reports its process over: the run's end (Codex doesn't restart). */
function codexWorkerExited(runId: number): boolean {
  const l = codexLives.get(runId);
  if (l && !l.closed) onExit(l);
  return false;
}

/** How the session ended, from its log: the last turn's ```json block, its turns, refusals, the thread. */
export function codexOutcome(runId: number): LiveOutcome {
  const cfg = readCfg(runId);
  const read = (f: string) => {
    try {
      return fs.readFileSync(/*turbopackIgnore: true*/ f, "utf8");
    } catch {
      return "";
    }
  };
  let denials = 0;
  const threadRequests = new Set<string>();
  for (const line of read(inPath(runId)).split("\n")) {
    if (!line.startsWith("{")) continue;
    try {
      const m = (JSON.parse(line) as { msg?: Rpc }).msg;
      if (m?.method === "thread/start" || m?.method === "thread/resume") threadRequests.add(String(m.id));
      const d = m?.result?.decision;
      if (d === "decline" || d === "cancel" || m?.result?.action === "decline" || m?.result?.action === "cancel") denials++;
    } catch {
      // half written
    }
  }
  let turn = "";
  let lastText = "";
  let turns = 0;
  let sessionId: string | null = cfg?.resumeSession ?? null;
  for (const line of read(logPath(runId)).split("\n")) {
    if (!line.startsWith("{")) continue;
    let m: Rpc;
    try {
      m = JSON.parse(line) as Rpc;
    } catch {
      continue;
    }
    const p = m.params ?? {};
    if (m.method === "turn/started") turn = "";
    else if (m.method === "item/completed") {
      const item = (p.item ?? {}) as { type?: string; text?: string };
      if (item.type === "agentMessage" && item.text) turn += `${turn ? "\n\n" : ""}${item.text}`;
    } else if (m.method === "turn/completed") {
      turns++;
      if (turn.trim()) lastText = turn.trim();
    } else if (!m.method && m.id !== undefined && threadRequests.has(String(m.id))) sessionId = ((m.result?.thread ?? {}) as { id?: string }).id ?? sessionId;
  }
  return { result: resultOf(lastText), closed: !!cfg?.closing, lastText, costUsd: null, turns, denials, sessionId };
}

// ——— its process: on the launcher's work host, or a host of its own ———

async function connect(l: Live): Promise<net.Socket> {
  if (l.sock && !l.sock.destroyed) return l.sock;
  l.connecting ??= connectHost(l.files.info, l.cfg.token, { waitMs: 45000, gone: () => l.exited })
    .then((sock) => {
      sock.on("close", () => {
        if (l.sock === sock) l.sock = null;
      });
      l.sock = sock;
      return sock;
    })
    .finally(() => {
      l.connecting = null;
    });
  return l.connecting;
}

async function hostSend(l: Live, msg: Record<string, unknown>) {
  const s = await connect(l);
  await new Promise<void>((resolve, reject) => s.write(`${JSON.stringify(msg)}\n`, (e) => (e ? reject(e) : resolve())));
}

/** What Zeff sent, kept beside the log — without the MCP token. */
function keep(l: Live, msg: Rpc) {
  const config = msg.params?.config as Record<string, unknown> | undefined;
  const scrubbed = config?.["mcp_servers.zeff.http_headers"] ? { ...msg, params: { ...msg.params, config: { ...config, "mcp_servers.zeff.http_headers": "(hidden)" } } } : msg;
  fs.appendFileSync(/*turbopackIgnore: true*/ l.files.in, `${JSON.stringify({ type: "zeff_in", at: now(), msg: scrubbed })}\n`);
}

/** One JSON-RPC line to the CLI — kept beside the log, then sent where it runs. */
async function write(l: Live, msg: Rpc) {
  keep(l, msg);
  if (l.cfg.transport === "launcher") await writeToHost(l.runId, JSON.stringify(msg));
  else await hostSend(l, msg);
}

/** Its input ended: the app server quits. */
async function stopProcess(l: Live) {
  if (l.cfg.transport === "launcher") await closeOnHost(l.runId);
  else await hostSend(l, { zeffHost: "stop" }).catch(() => {});
}

let nextReq = 0;
const reqId = () => `zeff-${Date.now().toString(36)}-${++nextReq}`;

const textInput = (text: string): Input => ({ type: "text", text, text_elements: [] });

/** A turn with your input — with the model, effort and (switched) mode it is to run in. */
async function startTurn(l: Live, input: Input[]) {
  const id = reqId();
  const policy = policyOf(l);
  const params: Record<string, unknown> = { threadId: l.threadId, input };
  if (l.cfg.model) params.model = l.cfg.model;
  if (l.cfg.effort) params.effort = l.cfg.effort;
  if (l.cfg.policyChanged) {
    params.approvalPolicy = policy.approval;
    params.sandboxPolicy = sandboxPolicy(policy.sandbox);
    l.cfg.policyChanged = false;
    saveCfg(l);
  }
  l.turnRequests.add(id);
  l.waiting = null;
  await write(l, { id, method: "turn/start", params });
}

/** Start the app server for a session: initialize, then its thread (new, or the conversation it goes on with). */
async function startProcess(l: Live, rules: string, disallowedTools: string[]) {
  const policy = policyOf(l);
  // Zeff's MCP server of this run's account — its booking tools left out.
  const zeff = workerMcpServers(l.account).mcpServers.zeff as { url: string; headers?: Record<string, string> };
  const config: Record<string, unknown> = {
    "mcp_servers.zeff.url": zeff.url,
    "mcp_servers.zeff.disabled_tools": disallowedTools.filter((x) => x.startsWith("mcp__zeff__")).map((x) => x.slice("mcp__zeff__".length)),
    ...(zeff.headers ? { "mcp_servers.zeff.http_headers": zeff.headers } : {}),
    ...(l.cfg.effort ? { model_reasoning_effort: l.cfg.effort } : {}),
  };
  const common = { cwd: l.cfg.cwd, approvalPolicy: policy.approval, sandbox: policy.sandbox, config, developerInstructions: rules, ...(l.cfg.model ? { model: l.cfg.model } : {}) };
  const lines: Rpc[] = [
    { id: reqId(), method: "initialize", params: { clientInfo: { name: "zeff", title: "Zeff", version: "1" }, capabilities: { experimentalApi: true, requestAttestation: false } } },
    { method: "initialized" },
    l.cfg.resumeSession ? { id: reqId(), method: "thread/resume", params: { threadId: l.cfg.resumeSession, ...common } } : { id: reqId(), method: "thread/start", params: common },
  ];
  l.view.host = "starting";
  l.startingSince = Date.now();
  l.exited = false;
  changed();
  const { workerEnv } = await import("@/lib/work/runner");
  const features = await workHostFeatures();
  if (features?.includes("keep") && features.includes("write")) {
    l.cfg.transport = "launcher";
    for (const m of lines) keep(l, m);
    l.cfg.pid = await spawnOnHost({
      runId: l.runId,
      account: l.account,
      command: l.cfg.command,
      args: l.cfg.args,
      cwd: l.cfg.cwd,
      env: workerEnv(l.runId, true),
      stdin: "",
      stdinLines: lines.map((m) => JSON.stringify(m)),
      outFile: l.files.log,
      errFile: l.files.err,
      live: true,
      keep: true,
    });
    // The launcher's host writes no start line: it's up once it runs.
    l.view.host = "up";
    l.startingSince = null;
    saveCfg(l);
    const { updateRun } = await import("@/lib/work/store");
    updateRun(l.runId, { pid: l.cfg.pid });
    return;
  }
  // A host of its own: its config (the token Zeff talks to it with), started detached.
  l.cfg.transport = "own";
  saveCfg(l);
  fs.writeFileSync(/*turbopackIgnore: true*/ l.files.host, JSON.stringify({ command: l.cfg.command, args: l.cfg.args, cwd: l.cfg.cwd, log: l.files.log, err: l.files.err, info: l.files.info, token: l.cfg.token }));
  fs.rmSync(/*turbopackIgnore: true*/ l.files.info, { force: true });
  if (!fs.existsSync(/*turbopackIgnore: true*/ hostScript())) throw new Error(t("The session host is missing: {path} (Zeff runs from {cwd}).", { path: hostScript(), cwd: process.cwd() }));
  const err = fs.openSync(/*turbopackIgnore: true*/ l.files.err, "a");
  const child = spawn(/*turbopackIgnore: true*/ process.execPath, [hostScript(), l.files.host, "--detach"], { cwd: l.cfg.cwd, env: workerEnv(l.runId, true) as NodeJS.ProcessEnv, detached: true, stdio: ["ignore", "ignore", err], windowsHide: true });
  fs.closeSync(err);
  child.on("error", (e) => fail(l, e));
  child.on("exit", (code) => code && fail(l, new Error(t("The session host didn't start (exit {code}) — see above.", { code }))));
  child.unref();
  for (const m of lines) await write(l, m);
}

function newLive(runId: number, cfg: CodexCfg): Live {
  const l: Live = {
    runId,
    account: currentAccountId(),
    files: filesOf(runId),
    cfg,
    offset: 0,
    rest: "",
    inOffset: 0,
    inRest: "",
    sent: new Map(),
    turnRequests: new Set(),
    answered: new Set(),
    meta: new Map(),
    changes: new Map(),
    sock: null,
    connecting: null,
    view: {
      provider: "codex",
      modes: codexModes(cfg.allowBypass),
      features: ["images", "effort"],
      sessionId: cfg.resumeSession,
      model: cfg.model,
      models: [],
      effort: cfg.effort,
      elevated: false,
      commands: [],
      host: "down",
      conversation: cfg.conversation,
      asks: [],
      queued: 0,
      costUsd: null,
      shellPending: 0,
      allowBypass: cfg.allowBypass,
    },
    threadId: null,
    turnId: null,
    turnText: "",
    waiting: null,
    outbox: [],
    stopWanted: false,
    resultSeen: false,
    fatal: null,
    exited: false,
    startingSince: null,
    closed: false,
    missing: 0,
    ticks: 0,
    stopSent: false,
    caughtUp: false,
  };
  // The models your ChatGPT account offers (Codex's catalog, cached).
  void codexModels()
    .then((ms) => {
      l.view.models = ms.map((m) => ({ value: m.id, label: m.label, efforts: m.efforts }));
      changed();
    })
    .catch(() => {});
  return l;
}

/** Follow every live Codex session's logs (one timer for all). */
function ensureTick() {
  if (state.__zeffCodexTick) return;
  state.__zeffCodexTick = setInterval(() => {
    for (const l of codexLives.values()) {
      try {
        withAccount(l.account, () => follow(l));
      } catch (e) {
        console.error(`[work] following ${workRef(l.runId)} failed:`, e);
      }
    }
  }, 400);
  state.__zeffCodexTick.unref?.();
}

/** A new live Codex session for a run (LiveStart: what the runner knows; the CLI's own arguments made here). */
async function startCodex(s: LiveStart): Promise<void> {
  if (s.elevated) throw new Error(t("Only live Claude sessions run as administrator."));
  const cli = findCodexCli();
  if (!cli) throw new Error(t("The Codex CLI wasn't found — install it (npm install -g @openai/codex), or set CODEX_CLI."));
  const cfg: CodexCfg = {
    runId: s.runId,
    conversation: s.conversation,
    effort: s.effort,
    model: s.model,
    mode: POLICIES[s.mode] && (s.mode !== "full" || s.allowBypass) ? s.mode : "ask",
    allowBypass: s.allowBypass,
    askTimeoutMin: s.askTimeoutMin,
    readOnly: s.disallowedTools.some((x) => x === "Edit" || x === "Write"),
    command: cli.command,
    args: [...cli.args, "app-server"],
    cwd: s.cwd,
    token: crypto.randomBytes(24).toString("hex"),
    pending: s.prompt,
    resumeSession: s.resumeSession,
  };
  fs.mkdirSync(/*turbopackIgnore: true*/ sessionsDir(), { recursive: true });
  // Its log marked as Codex's first (readLog reads it as such), then the host appends to it.
  markCodexRun(s.runId);
  const l = newLive(s.runId, cfg);
  saveCfg(l);
  codexLives.set(s.runId, l);
  ensureTick();
  await startProcess(l, s.rules, s.disallowedTools);
}

/** After a server start: its running sessions followed again, their logs read from the start. */
export function reattachCodexSessions(runIds: number[]): void {
  for (const runId of runIds) {
    if (codexLives.has(runId)) continue;
    const cfg = readCfg(runId);
    if (!cfg) continue;
    const l = newLive(runId, cfg);
    l.view.host = processAlive(l) ? "up" : "down";
    codexLives.set(runId, l);
  }
  ensureTick();
}

// ——— what you do ———

const liveOf = (runId: number): Live => {
  const l = codexLives.get(runId);
  if (!l || l.closed) throw new Error(t("The session isn't running (any more)."));
  return l;
};

const IMAGE_EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

/** Your message (and pictures — as files beside the session, Codex reads them from disk): into the running turn, else a turn of its own. */
export async function sendToCodex(runId: number, text: string, images: { mediaType: string; data: string }[] = []) {
  const l = liveOf(runId);
  if (l.view.host === "down") throw new Error(t("The session isn't running (any more)."));
  const input: Input[] = [textInput(text)];
  images.forEach((img, i) => {
    const file = path.join(sessionsDir(), `${runId}.codex-img-${Date.now()}-${i}.${IMAGE_EXT[img.mediaType] ?? "png"}`);
    fs.writeFileSync(/*turbopackIgnore: true*/ file, Buffer.from(img.data, "base64"));
    input.push({ type: "localImage", path: file });
  });
  if (l.threadId && l.turnId && l.caughtUp) {
    await write(l, { id: reqId(), method: "turn/steer", params: { threadId: l.threadId, input, expectedTurnId: l.turnId } });
  } else if (!l.threadId || busy(l) || l.cfg.pending !== null || !l.caughtUp) l.outbox.push(input);
  else await startTurn(l, input);
  l.waiting = null;
  changed(true);
}

/** Codex's answer to a command or file change approval. */
function decision(available: unknown[] | null, a: AskAnswer): unknown {
  const offered = (d: string) => !available || available.some((x) => x === d);
  if (a.behavior === "allow") {
    if (!a.always) return "accept";
    if (offered("acceptForSession")) return "acceptForSession";
    return available?.find((x) => !!x && typeof x === "object" && "acceptWithExecpolicyAmendment" in x) ?? "accept";
  }
  return a.interrupt || !offered("decline") ? "cancel" : "decline";
}

/** Your answer to what it asks. */
export async function answer(runId: number, requestId: string, a: AskAnswer) {
  const l = liveOf(runId);
  const meta = l.meta.get(requestId);
  if (!meta || !l.view.asks.some((x) => x.requestId === requestId)) throw new Error(t("It doesn't wait for that any more."));
  const allow = a.behavior === "allow";
  let result: Record<string, unknown>;
  let cancelled = false;
  switch (meta.method) {
    case "item/tool/requestUserInput":
      result = { answers: allow ? Object.fromEntries(meta.questions.map((q) => [q.id, { answers: a.answers?.[q.question] ? [a.answers[q.question]] : [] }])) : {} };
      break;
    case "item/permissions/requestApproval":
      result = { permissions: allow ? Object.fromEntries(Object.entries(meta.permissions ?? {}).filter(([, v]) => v != null)) : {}, scope: allow && a.always ? "session" : "turn" };
      break;
    case "mcpServer/elicitation/request":
      result = allow ? { action: "accept", content: {}, _meta: null } : { action: a.interrupt ? "cancel" : "decline", content: null, _meta: null };
      break;
    default: {
      const d = decision(meta.available, a);
      cancelled = d === "cancel";
      result = { decision: d };
    }
  }
  await write(l, { id: meta.rpcId, result });
  l.answered.add(requestId);
  l.view.asks = l.view.asks.filter((x) => x.requestId !== requestId);
  changed(true);
  if (allow) return;
  if (a.interrupt) {
    await interruptCodex(runId);
    return;
  }
  // Why not (it reads it) — and, where Codex can only cancel the turn, a word to go on with.
  const why = a.message?.trim() || (cancelled ? "Abgelehnt — mach das nicht; finde einen anderen Weg oder frag nach." : "");
  if (why) await sendToCodex(runId, why);
}

/** Stop its current turn (what you sent meanwhile is dropped too). */
export async function interruptCodex(runId: number) {
  const l = liveOf(runId);
  l.outbox = [];
  if (l.threadId && l.turnId) await write(l, { id: reqId(), method: "turn/interrupt", params: { threadId: l.threadId, turnId: l.turnId } });
  else if (busy(l)) l.stopWanted = true;
  changed();
}

/** A stop asked for while its turn had no id yet: now. */
function stopIfWanted(l: Live) {
  if (!l.stopWanted || !l.turnId || !l.threadId || !l.caughtUp) return;
  l.stopWanted = false;
  void write(l, { id: reqId(), method: "turn/interrupt", params: { threadId: l.threadId, turnId: l.turnId } }).catch(() => {});
}

/** Its mode (approval policy and sandbox), from the next turn on. */
async function setCodexMode(runId: number, mode: string) {
  const l = liveOf(runId);
  if (!codexModes(l.cfg.allowBypass).some((m) => m.id === mode)) throw new Error(mode === "full" ? t("Bypass isn't allowed — Code settings → “Bypass may be picked” (it applies to new sessions).") : t("Unknown mode."));
  l.cfg.mode = mode;
  l.cfg.policyChanged = true;
  saveCfg(l);
  changed();
}

/** Its model, from the next turn on. */
async function setCodexModel(runId: number, model: string) {
  const l = liveOf(runId);
  if (!/^[\w.[\]-]{1,80}$/.test(model)) throw new Error(t("Unknown model."));
  l.cfg.model = model;
  l.view.model = model;
  saveCfg(l);
  changed();
}

/** Its reasoning effort, from the next turn on. */
async function setCodexEffort(runId: number, effort: Effort) {
  const l = liveOf(runId);
  l.cfg.effort = effort;
  l.view.effort = effort;
  saveCfg(l);
  changed();
}

/** Finish: it's asked for its result now — that ends the run. */
export async function finishCodex(runId: number) {
  const l = liveOf(runId);
  l.cfg.finishing = true;
  saveCfg(l);
  await sendToCodex(
    runId,
    `Schließ jetzt ab: fasse zusammen, was du in dieser Session getan hast, und antworte mit dem Ergebnis als JSON in einem \`\`\`json-Block, nach diesem Schema:\n${JSON.stringify(WORK_RESULT_SCHEMA)}`,
  );
}

/** Close: end the session without a result. */
export async function closeCodex(runId: number) {
  const l = liveOf(runId);
  l.cfg.closing = true;
  saveCfg(l);
  if (l.exited) await end(l);
  else await stopProcess(l);
}

/** Stop it hard: the app server and everything it started. */
export function killCodex(runId: number) {
  const l = codexLives.get(runId);
  const cfg = l?.cfg ?? readCfg(runId);
  const files = l?.files ?? filesOf(runId);
  if (cfg?.transport === "launcher") void killOnHost(runId);
  else {
    const info = readHostInfo(files.info);
    if (l && !l.exited) void hostSend(l, { zeffHost: "kill" }).catch(() => {});
    if (info?.pid && pidAlive(info.pid)) {
      killPid(info.pid);
    }
  }
  if (l) l.closed = true;
  codexLives.delete(runId, l?.account);
  changed(true);
}

/** OpenAI's Codex CLI as a live-session driver (see lib/work/live-driver.ts). */
export const codexLiveDriver: LiveDriver = {
  provider: "codex",
  modes: ({ allowBypass }) => codexModes(allowBypass),
  start: startCodex,
  reattach: reattachCodexSessions,
  has: isCodexSession,
  runIds: () => [...codexLives.keys()],
  view: codexLiveView,
  idle: codexIdle,
  send: sendToCodex,
  answer,
  interrupt: interruptCodex,
  setMode: setCodexMode,
  setModel: setCodexModel,
  setEffort: setCodexEffort,
  finish: finishCodex,
  close: closeCodex,
  kill: killCodex,
  outcome: codexOutcome,
  workerExited: codexWorkerExited,
};
