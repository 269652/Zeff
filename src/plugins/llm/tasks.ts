/**
 * The LLM plugin's tasks — what Zeff has an AI do, as building blocks the other plugins call:
 * each its own backend and model (or the default), all with your instructions and context.
 * Client-safe.
 */

export const LLM_TASKS = [
  { id: "ticket-lage", label: "Briefing", what: "Reads your tickets — Jira and your Kanban cards (KB-…) — with all their context and makes the briefing and the todos." },
  { id: "board-lage", label: "Board briefing", what: "Assesses where all current tickets of your Jira boards stand (for the Kanban cards) — without todos." },
  { id: "recap", label: "Recap", what: "Sums up a day: what you did." },
  { id: "mail-todos", label: "Mail review", what: "Finds what you have to do in new mails." },
  { id: "mail-relations", label: "Mail matching", what: "Matches each todo with the mails it is about." },
  { id: "note-todos", label: "Note review", what: "Finds what you have to do in new and changed notes (Google Keep, your Keep boards)." },
  { id: "note-relations", label: "Note matching", what: "Matches each todo with the notes it is about." },
  { id: "knowledge-relations", label: "Knowledge matching", what: "Picks from the knowledge base's hits what really fits each todo." },
  { id: "people-dates", label: "People's dates", what: "Finds birthdays, anniversaries and other important dates of your people in the knowledge and in your messages (People plugin)." },
  { id: "reply-draft", label: "Reply draft", what: "Writes the reply to a message (WhatsApp, mail, Teams) a todo is about — from the conversation." },
  { id: "auto-actions", label: "Auto actions", what: "Turns todos into ready-made actions (message, comment, mail, meeting, hand-over)." },
  { id: "worker", label: "Worker", what: "Works on a todo (Work tab, ✨ To Copilot) — in the repo, with tools." },
  { id: "general", label: "Other", what: "Everything else (e.g. the connection test)." },
] as const;

export type LlmTaskId = (typeof LLM_TASKS)[number]["id"];
export const isLlmTask = (v: unknown): v is LlmTaskId => LLM_TASKS.some((t) => t.id === v);

/** A task's own backend and model ("" = the default). */
export type LlmTaskSetting = { provider?: "" | "copilot" | "claude"; model?: string };

export type LlmSettings = {
  /** What goes with every prompt and to every agent: how to work, what never to do. */
  instructions: string;
  /** Who you are, what you work on — the background every task gets. */
  context: string;
  tasks: Partial<Record<LlmTaskId, LlmTaskSetting>>;
};

export const EMPTY_LLM_SETTINGS: LlmSettings = { instructions: "", context: "", tasks: {} };

/** At most this much of instructions and context goes with a prompt (Copilot takes it on the command line). */
export const LLM_PREAMBLE_MAX = 2500;
