import type { T } from "@/lib/i18n/shared";

/** The AI tasks jira-lage has Zeff run (llm plugin: each its own backend and model). Client-safe; found by plugins/llm/tasks.ts through llm-tasks.generated.ts. */
export const JIRA_LAGE_LLM_TASKS = (t: T) =>
  [
    { plugin: "jira-lage", id: "board-lage", label: t("Board briefing"), what: t("Assesses where all current tickets of your Jira boards stand (for the Kanban cards) — without todos.") },
  ] as const;
