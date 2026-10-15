import type { T } from "@/lib/i18n/shared";

/** The AI tasks documents has Zeff run (llm plugin: each its own backend and model). Client-safe; found by plugins/llm/tasks.ts through llm-tasks.generated.ts. */
export const DOCUMENTS_LLM_TASKS = (t: T) =>
  [
    { plugin: "documents", id: "doc-todos", label: t("Document review"), what: t("Finds what you have to do in new and changed documents (Documents plugin).") },
    { plugin: "documents", id: "doc-relations", label: t("Document matching"), what: t("Matches each todo with the documents it is about.") },
  ] as const;
