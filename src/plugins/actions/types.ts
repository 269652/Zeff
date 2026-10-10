/**
 * Actions: what a plugin lets Zeff do with a click — post a Jira comment, send a Teams message,
 * open a mail draft in Outlook, hand a todo to a worker. Each plugin contributes its own (its
 * actions.ts: what they are, client-safe; its run.ts: how they run, on the server). The core
 * gathers them: the todos' buttons, the AI's dictionary (only the installed plugins'), the
 * validation of what an AI proposes, the runner. Client-safe.
 */
import type { TodoOp } from "@/lib/boards/shared";
import type { PluginId } from "../catalog";

export type ActionType = TodoOp["type"];
export type OpOf<T extends ActionType> = Extract<TodoOp, { type: T }>;

/** What an operation note shows: its heading, the line under it, its text (a comment, a message) — or the files. */
export type ActionNote = { heading: string; detail: string | null; body: string | null; files?: string[] };

/** Read what an AI handed over (strings mostly); the todo's ticket is the default one. */
export type CleanContext = { ticket: string };

export type ActionSpec<T extends ActionType = ActionType> = {
  type: T;
  /** The plugin that contributes it (null: Zeff's own). */
  plugin: PluginId | null;
  /** Its name ("Teams-Nachricht senden") and its button's verb ("Send"). */
  label: string;
  verb: string;
  /**
   * Offered to the AI (the Ticket-Lage, the auto-actions): when to use it, its fields, an example.
   * Without: Zeff makes it itself (a delivery step), it's never proposed.
   */
  offer?: { when: string; fields: Record<string, string>; example: Record<string, string> };
  /** Its parts as an AI may hand them over, cleaned — null: incomplete, dropped. */
  clean: (o: Record<string, unknown>, ctx: CleanContext) => OpOf<T> | null;
  /** In a few words ("PROJ-415 → Testing"). */
  title: (op: OpOf<T>) => string;
  note: (op: OpOf<T>) => ActionNote;
  /**
   * Runs in your browser instead: a pre-filled window (a mail draft, an appointment) you finish
   * and send yourself — its address.
   */
  href?: (op: OpOf<T>) => string;
  /** Talking (a reply, a message, a comment): doing it is doing the todo. */
  comms?: boolean;
  /** One of Zeff's delivery steps (push, MR, merge). */
  delivery?: boolean;
};

/** Small helpers for clean(): a trimmed string, a ticket key (else the todo's), a GitLab note id. */
export const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
export const ticketKey = (v: unknown, fallback: string) => (/^[A-Z][A-Z0-9]+-\d+$/i.test(str(v)) ? str(v).toUpperCase() : fallback);
export const noteId = (v: unknown) => /(?:gitlab:)?(note:\d+)/.exec(str(v))?.[1] ?? "";

/** An action spec, typed by its own operation. */
export const action = <T extends ActionType>(spec: ActionSpec<T>) => spec;
