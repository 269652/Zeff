import { claudeLiveDriver } from "@/plugins/claude-cli/live";
import { codexLiveDriver } from "@/plugins/codex-cli/live";
import type { LiveView } from "@/plugins/copilot-cli/live-state";
import type { AskAnswer, ClaudeAsk, Effort, SessionLiveView, SessionMode, WorkResult } from "./shared";

/**
 * Live sessions, whatever CLI runs them: a driver per provider (Claude Code's in
 * plugins/claude-cli/live.ts; others register theirs). The runner starts a session through its
 * provider's driver; the Work tab, its live route, the attention bar and the host's exit report
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
  /** Going on in a conversation (resume it), or a new one's id (where the CLI takes one). */
  resumeSession: string | null;
  newSessionId: string | null;
};

/** How a session ended, from what it left (its log): for the runner's finish. */
export type LiveOutcome = { result: WorkResult | null; closed: boolean; lastText: string; costUsd: number | null; turns: number; denials: number; sessionId: string | null };

export type LiveDriver = {
  /** The AI provider it runs (llm's: claude, codex …). */
  provider: string;
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

/** A provider's driver joins (see the end of this file). */
export function registerLiveDriver(d: LiveDriver): void {
  drivers.set(d.provider, d);
}

export const liveDrivers = (): LiveDriver[] => [...drivers.values()];
export const liveDriverFor = (provider: string): LiveDriver | undefined => drivers.get(provider);
/** The driver whose session this run is (or was). */
export const liveDriverOf = (runId: number): LiveDriver | undefined => liveDrivers().find((d) => d.has(runId));
/** A run's live session as the pages see it (none: not live, or over). */
export const liveSessionView = (runId: number) => {
  for (const d of drivers.values()) {
    const v = d.view(runId);
    if (v) return v;
  }
  return undefined;
};
/** A live session waiting for you: it doesn't hold a worker. */
export const liveIdle = (runId: number): boolean => liveDrivers().some((d) => d.idle(runId));

/** What it asks, in a few words (the attention bar, the sidebar). */
export function askTitle(a: ClaudeAsk, t: (s: string) => string): string {
  if (a.tool === "ExitPlanMode") return t("Its plan — go ahead?");
  if (a.tool === "AskUserQuestion") return t("A question for you");
  return `${a.tool}${a.description ? `: ${a.description}` : ""}`;
}

// The drivers Zeff brings — another provider's is imported and registered here too. (Their modules
// import only types from this one: no cycle at load.)
registerLiveDriver(claudeLiveDriver);
registerLiveDriver(codexLiveDriver);
