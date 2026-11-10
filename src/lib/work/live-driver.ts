import { claudeLiveDriver } from "@/plugins/claude-cli/live";
import { codexLiveDriver } from "@/plugins/codex-cli/live";
import type { LiveView } from "@/plugins/copilot-cli/live-state";
import { runsByStatus } from "./store";
import { activeRunByTodo, type AskAnswer, type ClaudeAsk, type Effort, type SessionLiveView, type SessionMode, type WorkResult } from "./shared";

/**
 * Live sessions, whatever CLI runs them: a driver per provider (Claude Code's in
 * plugins/claude-cli/live.ts; others register theirs). The runner starts a session through its
 * provider's driver; the Code tab, its live route, the attention bar and the host's exit report
 * go through the driver that has the run. A driver keeps its sessions' state itself (in memory,
 * found again after a restart: reattach) and shows them as one shape (SessionLiveView).
 */

/** Everything a driver needs to start a session — the CLI's own arguments are the driver's business. */
export type LiveStart = {
  runId: number;
  /** You talk to it (it waits after each turn till you finish it) — else a task that ends with its result. */
  conversation: boolean;
  elevated: boolean;
  effort: Effort;
  model: string | null;
  /** One of the driver's modes. */
  mode: string;
  allowBypass: boolean;
  /** A task's question nobody answers: refused after this many minutes (0: it waits). */
  askTimeoutMin: number;
  cwd: string;
  /** The worker's rules (a system prompt to append) and its first message. */
  rules: string;
  prompt: string;
  /** A name for the session (where the CLI shows one). */
  name: string;
  /** Tools it must not use (Zeff's booking tools; edits for runs that only look). */
  disallowedTools: string[];
  /** Tools approved in advance (the CLI doesn't ask or refuse them). */
  allowedTools?: string[];
  /** Going on in a conversation (resume it), or a new one's id (where the CLI takes one). */
  resumeSession: string | null;
  newSessionId: string | null;
};

/** How a session ended, from what it left (its log): for the runner's finish. */
export type LiveOutcome = { result: WorkResult | null; /** Its result was taken in already, at the end of a turn. */ applied?: boolean; closed: boolean; lastText: string; costUsd: number | null; turns: number; denials: number; sessionId: string | null };

export type LiveDriver = {
  /** The AI provider it runs (llm's: claude, codex …). */
  provider: string;
  /** Zeff hands the CLI the session's id to use (Claude: --session-id) — else the CLI makes its own and the driver reports it (Codex: its thread). */
  assignsSessionId?: boolean;
  /** Its modes (Bypass only when allowed), and the one a session starts in when none is picked. */
  modes(opts: { allowBypass: boolean }): SessionMode[];
  start(s: LiveStart): Promise<void>;
  /** After a server start: its running sessions followed again. */
  reattach(runIds: number[]): void;
  /** This run is (or was) one of its sessions. */
  has(runId: number): boolean;
  /** Its sessions live now. */
  runIds(): number[];
  view(runId: number): { live: LiveView; session: SessionLiveView } | undefined;
  /** Waiting for you (not working, nothing asked): it doesn't hold a worker. */
  idle(runId: number): boolean;
  send(runId: number, text: string, images: { mediaType: string; data: string }[]): Promise<void>;
  answer(runId: number, requestId: string, a: AskAnswer): Promise<void>;
  interrupt(runId: number): Promise<void>;
  setMode(runId: number, mode: string): Promise<void>;
  setModel(runId: number, model: string): Promise<void>;
  setEffort?(runId: number, effort: Effort): Promise<void>;
  /** A command in its folder, its output going along with your next message (Claude Code's !). */
  shell?(runId: number, cmd: string): Promise<{ out: string; code: number | null }>;
  /** Ask it for its result (that ends the run), or end it without one, or stop it hard. */
  finish(runId: number): Promise<void>;
  close(runId: number): Promise<void>;
  kill(runId: number): void;
  outcome(runId: number): LiveOutcome;
  /** The work host reports its process over: true when that's not the run's end (a restart). */
  workerExited?(runId: number): boolean;
};

const state = globalThis as { __zeffLiveDrivers?: Map<string, LiveDriver> };
const drivers = (state.__zeffLiveDrivers ??= new Map<string, LiveDriver>());

/**
 * The drivers Zeff brings — another provider's is imported and added here too. On first use, not
 * at load: a driver's module can lead back here through its imports (mcp → … → runner) before it
 * has its driver (a test that loads plugins/claude-cli/live.ts first). Their modules import only
 * types from this one. Each load of this module adds them again (fresh code after a reload).
 */
let builtIn = false;
function builtIns() {
  if (builtIn) return;
  builtIn = true;
  drivers.set(claudeLiveDriver.provider, claudeLiveDriver);
  drivers.set(codexLiveDriver.provider, codexLiveDriver);
}

/** A provider's driver joins (after Zeff's own). */
export function registerLiveDriver(d: LiveDriver): void {
  builtIns();
  drivers.set(d.provider, d);
}

export const liveDrivers = (): LiveDriver[] => {
  builtIns();
  return [...drivers.values()];
};
export const liveDriverFor = (provider: string): LiveDriver | undefined => {
  builtIns();
  return drivers.get(provider);
};
/** The driver whose session this run is (or was). */
export const liveDriverOf = (runId: number): LiveDriver | undefined => liveDrivers().find((d) => d.has(runId));
/** A run's live session as the pages see it (none: not live, or over). */
export const liveSessionView = (runId: number) => {
  for (const d of liveDrivers()) {
    const v = d.view(runId);
    if (v) return v;
  }
  return undefined;
};
/** A live session waiting for you: it doesn't hold a worker. */
export const liveIdle = (runId: number): boolean => liveDrivers().some((d) => d.idle(runId));

/**
 * The todos a worker is working on right now - the one answer to "being worked on": a queued or running run that is
 * not a live session waiting for you (that one is idle: its todo can be ticked off without stopping it).
 */
export function workingTodoIds(): number[] {
  return runsByStatus(["queued", "running"]).filter((r) => !liveIdle(r.id)).map((r) => r.todoId);
}

/** The same todos with the run working on each (todo id → run id; several runs: the running one, the newest) — its link. */
export function workingRuns(): Record<number, number> {
  return activeRunByTodo(runsByStatus(["queued", "running"]).filter((r) => !liveIdle(r.id)));
}

/** What it asks, in a few words (the attention bar, the sidebar). */
export function askTitle(a: ClaudeAsk, t: (s: string) => string): string {
  if (a.tool === "ExitPlanMode") return t("Its plan — go ahead?");
  if (a.tool === "AskUserQuestion") return t("A question for you");
  return `${a.tool}${a.description ? `: ${a.description}` : ""}`;
}
