import type { T } from "@/lib/i18n/shared";

/** The AI tasks keep has Zeff run (llm plugin: each its own backend and model). Client-safe; found by plugins/llm/tasks.ts through llm-tasks.generated.ts. */
export const KEEP_LLM_TASKS = (t: T) =>
  [
    { plugin: "keep", id: "note-todos", label: t("Note review"), what: t("Finds what you have to do in new and changed notes (Google Keep, your Keep boards).") },
    { plugin: "keep", id: "note-relations", label: t("Note matching"), what: t("Matches each todo with the notes it is about.") },
  ] as const;
