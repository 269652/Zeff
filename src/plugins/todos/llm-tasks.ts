import type { T } from "@/lib/i18n/shared";

/** The AI tasks todos has Zeff run (llm plugin: each its own backend and model). Client-safe; found by plugins/llm/tasks.ts through llm-tasks.generated.ts. */
export const TODOS_LLM_TASKS = (t: T) =>
  [
    { plugin: "todos", id: "ticket-lage", label: t("Briefing"), what: t("Reads your tickets — Jira and your Kanban cards (KB-…) — with all their context and makes the briefing and the todos.") },
    { plugin: "todos", id: "recap", label: t("Recap"), what: t("Sums up a day: what you did.") },
    { plugin: "todos", id: "mail-todos", label: t("Mail review"), what: t("Finds what you have to do in new mails.") },
    { plugin: "todos", id: "mail-relations", label: t("Mail matching"), what: t("Matches each todo with the mails it is about.") },
    { plugin: "todos", id: "repeat-text", label: t("Repeat wording"), what: t("Words the next todo of a repeating one (a rate every 15th) without what only held the first time."), idempotent: true },
    { plugin: "todos", id: "day-plan", label: t("Day plan"), what: t("Orders today's todos into time blocks around your appointments (Today → Plan my day) — a proposal you apply as suggestions.") },
    { plugin: "todos", id: "reply-draft", label: t("Reply draft"), what: t("Writes the reply to a message (WhatsApp, mail, Teams) a todo is about — from the conversation.") },
  ] as const;
