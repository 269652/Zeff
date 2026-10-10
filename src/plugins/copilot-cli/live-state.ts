import type { ChildProcess } from "node:child_process";

/** A live (interactive) worker as the pages see it: its mode, whether it's at work, what it asks of you. */
export type LiveView = {
  /** The session's mode (Copilot: agent, plan, autopilot) and the ones it has. */
  mode: string;
  modes: { id: string; name: string }[];
  /** A turn is under way (it works); else it waits for you. */
  busy: boolean;
  /** It wants to do something and asks first: what, and the answers it offers. */
  permission: { title: string; detail: string | null; options: { id: string; name: string; kind: string }[] } | null;
  /** Its turn ended without a result: what it said last (a question, a status) — your move. */
  waiting: string | null;
};

/** A live session, server side (one Next server holds it; a restart ends it). */
export type Live = {
  runId: number;
  child: ChildProcess;
  sessionId: string;
  nextId: number;
  pending: Map<number, (msg: { result?: unknown; error?: { message?: string } }) => void>;
  /** The JSON-RPC id of the permission request it waits on. */
  permissionRpcId: number | string | null;
  view: LiveView;
  /** What it has said in the current turn (its result is parsed from it). */
  turnText: string;
  buf: string;
};

const state = globalThis as { __zeffLive?: Map<number, Live> };
export const lives = (state.__zeffLive ??= new Map<number, Live>());

/** A run's live session, as the pages see it (none: not an interactive one, or over). */
export const liveView = (runId: number): LiveView | undefined => lives.get(runId)?.view;
