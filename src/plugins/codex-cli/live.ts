import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { t } from "@/lib/i18n/server";
import { inPath, logPath } from "@/lib/work/log";
import { workerMcpServers } from "@/lib/work/mcp";
import { changed, liveCore, now, reqId, resultOf, sessionsDir, type LiveBase, type LiveCfgBase } from "@/lib/work/live-core";
import type { AskAnswer, ClaudeAsk, Effort, SessionLiveView, SessionMode } from "@/lib/work/shared";
import type { LiveDriver, LiveOutcome, LiveStart } from "@/lib/work/live-driver";
import type { LiveView } from "@/plugins/copilot-cli/live-state";
import { codexModels, codexSandboxState, findCodexCli } from "./cli";
import { commandText, fileChangeInput, markCodexRun, type FileUpdate } from "./log";

/**
 * Live Codex sessions (ChatGPT) on the Code tab: `codex app-server`, Codex's own JSON-RPC over
 * stdio (a line each way) — a thread, its turns, what it asks before it runs a command or changes
 * a file, your answers. Like Claude Code's (plugins/claude-cli/live.ts) it runs under a host
 * outside Zeff's server (the launcher's work host, or scripts/work-session-host.mjs), so a
 * restart or a deploy doesn't end it: the host writes what the CLI prints into the run's log,
 * Zeff keeps what it sends beside it (log.ts: inPath) and reads both from the start after a
 * restart. That much both share (lib/work/live-core.ts); here is Codex's protocol.
 *
 * Its thread id is the session's: a later run resumes it (thread/resume). A message sent while it
 * works steers the running turn (turn/steer); one it can't take waits for the next turn.
 */

/** What a session was started with — kept beside its log (a restarted server reads it). */
type CodexCfg = LiveCfgBase & {
  effort: Effort;
  mode: string;
  /** Its runs that only look (no edits allowed): the read-only sandbox, whatever the mode. */
  readOnly: boolean;
  /** The first message, till the thread is there to take it (turn/start needs its id). */
  pending: string | null;
  /** The mode was switched: the next turn takes its approval policy and sandbox. */
  policyChanged?: boolean;
  resumeSession: string | null;
};

/** A JSON-RPC message, either way (Codex's: no "jsonrpc" member). */
type Rpc = { id?: string | number; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown>; error?: { code?: number; message?: string } };
/** Codex's user input items (text, a picture on disk). */
type Input = { type: "text"; text: string; text_elements: [] } | { type: "localImage"; path: string };

/** What an open request of the CLI needs for its answer. */
type AskMeta = { rpcId: string | number; method: string; available: unknown[] | null; questions: { id: string; question: string }[]; permissions: Record<string, unknown> | null };

type Live = LiveBase<CodexCfg> & {
  /** Zeff's requests by id (what a response answers), and its turn/starts not answered yet. */
  sent: Map<string, { method: string; input?: Input[] }>;
  turnRequests: Set<string>;
  meta: Map<string, AskMeta>;
  /** File changes by item (an approval names the item only). */
  changes: Map<string, FileUpdate[]>;
  threadId: string | null;
  turnId: string | null;
  /** Messages for the next turn (sent before the thread was there, or not taken by the running turn). */
  outbox: Input[][];
  /** Stop asked for before the turn had its id: sent once it has. */
  stopWanted: boolean;
  /** Something that ends it (the thread didn't start). */
  fatal: string | null;
};

const busy = (l: Live) => l.turnId !== null || l.turnRequests.size > 0;

const core = liveCore<CodexCfg, Live>({
  keys: { map: "__zeffCodexLive", runs: "__zeffCodexLiveRuns", tick: "__zeffCodexTick" },
  // (Not <run>.json — that's Claude's: its driver would take the run for its own.)
  infix: ".codex",
  create: newLive,
  take,
  takeIn,
  busy,
  ready: (l) => !!l.threadId && !l.cfg.pending,
  idle: (l) => !!l.threadId && !l.cfg.pending && !l.outbox.length,
  mode: (l) => l.cfg.mode,
  sidebarModes: (l) => l.view.modes.map((m) => ({ id: m.id, name: m.label })),
  detailFields: ["command", "file_path", "url", "message"],
  session: (l) => ({ queued: l.outbox.length, costUsd: null }),
  afterFollow: (l) => {
    if (l.caughtUp && !l.closed) void flush(l).catch((e) => fs.appendFileSync(/*turbopackIgnore: true*/ l.files.err, `${e instanceof Error ? e.message : String(e)}\n`));
  },
  onExit: (l) => {
    l.turnId = null;
    l.turnRequests.clear();
  },
  beforeSettle: (l) => {
    if (!l.fatal) return false;
    core.fail(l, new Error(l.fatal));
    return true;
  },
  askTimeoutMessage: (min) => `Niemand hat innerhalb von ${min} Minuten geantwortet — mach ohne weiter, oder schließ mit outcome blocked und der Frage als Follow-up ab.`,
  answer,
  failKeepsProcess: true,
  scrub,
  // The pictures you sent it.
  onDrop: (l) => {
    try {
      for (const f of fs.readdirSync(/*turbopackIgnore: true*/ sessionsDir())) if (f.startsWith(`${l.runId}.codex-img-`)) fs.rmSync(/*turbopackIgnore: true*/ path.join(sessionsDir(), f), { force: true });
    } catch {
      // no folder
    }
  },
  send: (runId, text) => sendToCodex(runId, text),
});

// Per account (a run's id is its account's): two accounts served side by side never see or steer each other's session.
export const codexLives = core.lives;

/** This run is (or was) a live Codex session. */
export const isCodexSession = (runId: number) => core.isSession(runId);

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

/** The live session as the pages see it (the Copilot-shaped part for the sidebar and attention; the rest under `session`). */
export const codexLiveView = (runId: number): { live: LiveView; session: SessionLiveView } | undefined => core.view(runId);

/** Waits for you (not working, nothing asked): it doesn't hold a worker. */
export const codexIdle = (runId: number): boolean => core.idle(runId);

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
    } else if (m.event === "exit") core.onExit(l);
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
  if (l.caughtUp) void core.write(l, { id: m.id, error: { code: -32601, message: `Zeff doesn't serve ${m.method}` } }).catch(() => {});
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

/** The thread there and nothing under way: the first message, or what waited, as the next turn. */
async function flush(l: Live) {
  if (!l.threadId || busy(l) || l.view.host !== "up" || l.exited) return;
  if (l.cfg.pending !== null) {
    const text = l.cfg.pending;
    l.cfg.pending = null;
    core.saveCfg(l);
    await startTurn(l, [textInput(text)]);
  } else if (l.outbox.length) await startTurn(l, l.outbox.splice(0).flat());
}

/** The launcher's work host reports its process over: the run's end (Codex doesn't restart). */
function codexWorkerExited(runId: number): boolean {
  const l = codexLives.get(runId);
  if (l && !l.closed) core.onExit(l);
  return false;
}

/** How the session ended, from its log: the last turn's ```json block, its turns, refusals, the thread. */
export function codexOutcome(runId: number): LiveOutcome {
  const cfg = core.readCfg(runId);
  let denials = 0;
  const threadRequests = new Set<string>();
  for (const line of core.readAll(inPath(runId)).split("\n")) {
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
  for (const line of core.readAll(logPath(runId)).split("\n")) {
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

// ——— its process ———

/** What Zeff sent, as kept beside the log — without the MCP token. */
function scrub(msg: Rpc): Rpc {
  const config = msg.params?.config as Record<string, unknown> | undefined;
  return config?.["mcp_servers.zeff.http_headers"] ? { ...msg, params: { ...msg.params, config: { ...config, "mcp_servers.zeff.http_headers": "(hidden)" } } } : msg;
}

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
    core.saveCfg(l);
  }
  l.turnRequests.add(id);
  l.waiting = null;
  await core.write(l, { id, method: "turn/start", params });
}

/** Start the app server for a session (live-core: where it runs): initialize, then its thread (new, or the conversation it goes on with). */
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
  // The launcher's host writes no start line: it's up once it runs.
  await core.launch(l, l.cfg.args, lines, { upOnSpawn: true });
}

function newLive(runId: number, cfg: CodexCfg): Live {
  const l: Live = {
    ...core.base(runId, cfg, {
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
    }),
    sent: new Map(),
    turnRequests: new Set(),
    meta: new Map(),
    changes: new Map(),
    threadId: null,
    turnId: null,
    outbox: [],
    stopWanted: false,
    fatal: null,
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
  core.saveCfg(l);
  core.register(l);
  await startProcess(l, s.rules, s.disallowedTools);
}

/** After a server start: its running sessions followed again, their logs read from the start. */
export const reattachCodexSessions = (runIds: number[]): void => core.reattach(runIds);

// ——— what you do ———

const IMAGE_EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

/** Your message (and pictures — as files beside the session, Codex reads them from disk): into the running turn, else a turn of its own. */
export async function sendToCodex(runId: number, text: string, images: { mediaType: string; data: string }[] = []) {
  const l = core.liveOf(runId);
  if (l.view.host === "down") throw new Error(t("The session isn't running (any more)."));
  const input: Input[] = [textInput(text)];
  images.forEach((img, i) => {
    const file = path.join(sessionsDir(), `${runId}.codex-img-${Date.now()}-${i}.${IMAGE_EXT[img.mediaType] ?? "png"}`);
    fs.writeFileSync(/*turbopackIgnore: true*/ file, Buffer.from(img.data, "base64"));
    input.push({ type: "localImage", path: file });
  });
  if (l.threadId && l.turnId && l.caughtUp) {
    await core.write(l, { id: reqId(), method: "turn/steer", params: { threadId: l.threadId, input, expectedTurnId: l.turnId } });
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
  const l = core.liveOf(runId);
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
  await core.write(l, { id: meta.rpcId, result });
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
  const l = core.liveOf(runId);
  l.outbox = [];
  if (l.threadId && l.turnId) await core.write(l, { id: reqId(), method: "turn/interrupt", params: { threadId: l.threadId, turnId: l.turnId } });
  else if (busy(l)) l.stopWanted = true;
  changed();
}

/** A stop asked for while its turn had no id yet: now. */
function stopIfWanted(l: Live) {
  if (!l.stopWanted || !l.turnId || !l.threadId || !l.caughtUp) return;
  l.stopWanted = false;
  void core.write(l, { id: reqId(), method: "turn/interrupt", params: { threadId: l.threadId, turnId: l.turnId } }).catch(() => {});
}

/** Its mode (approval policy and sandbox), from the next turn on. */
async function setCodexMode(runId: number, mode: string) {
  const l = core.liveOf(runId);
  if (!codexModes(l.cfg.allowBypass).some((m) => m.id === mode)) throw new Error(mode === "full" ? t("Bypass isn't allowed — Code settings → “Bypass may be picked” (it applies to new sessions).") : t("Unknown mode."));
  l.cfg.mode = mode;
  l.cfg.policyChanged = true;
  core.saveCfg(l);
  changed();
}

/** Its model, from the next turn on. */
const setCodexModel = (runId: number, model: string) => core.setModel(runId, model);

/** Its reasoning effort, from the next turn on. */
async function setCodexEffort(runId: number, effort: Effort) {
  const l = core.liveOf(runId);
  l.cfg.effort = effort;
  l.view.effort = effort;
  core.saveCfg(l);
  changed();
}

/** Finish: it's asked for its result now — that ends the run. */
export const finishCodex = (runId: number) => core.finish(runId);

/** Close: end the session without a result. */
export const closeCodex = (runId: number) => core.close(runId);

/** Stop it hard: the app server and everything it started. */
export const killCodex = (runId: number) => core.kill(runId);

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
