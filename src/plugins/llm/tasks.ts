/**
 * The LLM plugin's tasks — what Zeff has an AI do, as building blocks the other plugins call:
 * each its own backend and model (or the default), all with your instructions and context.
 * Client-safe.
 */
import { translator, type T } from "@/lib/i18n/shared";

/** The tasks — their names and what each does in the language of `t` (English without). */
export const llmTasks = (t: T = translator("en")) =>
  [
    { id: "ticket-lage", label: t("Briefing"), what: t("Reads your tickets — Jira and your Kanban cards (KB-…) — with all their context and makes the briefing and the todos.") },
    { id: "board-lage", label: t("Board briefing"), what: t("Assesses where all current tickets of your Jira boards stand (for the Kanban cards) — without todos.") },
    { id: "recap", label: t("Recap"), what: t("Sums up a day: what you did.") },
    { id: "mail-todos", label: t("Mail review"), what: t("Finds what you have to do in new mails.") },
    { id: "mail-relations", label: t("Mail matching"), what: t("Matches each todo with the mails it is about.") },
    { id: "note-todos", label: t("Note review"), what: t("Finds what you have to do in new and changed notes (Google Keep, your Keep boards).") },
    { id: "note-relations", label: t("Note matching"), what: t("Matches each todo with the notes it is about.") },
    { id: "doc-todos", label: t("Document review"), what: t("Finds what you have to do in new and changed documents (Documents plugin).") },
    { id: "doc-relations", label: t("Document matching"), what: t("Matches each todo with the documents it is about.") },
    { id: "knowledge-relations", label: t("Knowledge matching"), what: t("Picks from the knowledge base's hits what really fits each todo.") },
    { id: "people-dates", label: t("People's dates"), what: t("Finds birthdays, anniversaries and other important dates of your people in the knowledge and in your messages (People plugin).") },
    { id: "people-normalize", label: t("People matching"), what: t("Finds who is meant by the names in your todos — one person under all their names: aliases, new profiles for contacts, duplicates merged (People plugin).") },
    { id: "news-digest", label: t("News overview"), what: t("Sums up the best unread news of the day for you and says why each pick fits (News plugin).") },
    { id: "news-feeds", label: t("News feed finder"), what: t("Names outlets, blogs and newsletters worth reading on a topic — Zeff then looks for their feeds and checks them (News plugin).") },
    { id: "reply-draft", label: t("Reply draft"), what: t("Writes the reply to a message (WhatsApp, mail, Teams) a todo is about — from the conversation.") },
    { id: "auto-actions", label: t("Auto actions"), what: t("Turns todos into ready-made actions (message, comment, mail, meeting, hand-over).") },
    { id: "worker", label: t("Worker"), what: t("Works on a todo (Work tab, ✨ To Copilot) — in the repo, with tools.") },
    { id: "general", label: t("Other"), what: t("Everything else (e.g. the connection test).") },
  ] as const;
export const LLM_TASKS = llmTasks();

export type LlmTaskId = (typeof LLM_TASKS)[number]["id"];
export const isLlmTask = (v: unknown): v is LlmTaskId => LLM_TASKS.some((t) => t.id === v);

/** A task's own backend and model ("" = the default). */
export type LlmTaskSetting = { provider?: "" | "copilot" | "claude" | "codex"; model?: string };

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
