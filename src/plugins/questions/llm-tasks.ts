import type { T } from "@/lib/i18n/shared";

/** The AI tasks questions has Zeff run (llm plugin: each its own backend and model). Client-safe; found by plugins/llm/tasks.ts through llm-tasks.generated.ts. */
export const QUESTIONS_LLM_TASKS = (t: T) =>
  [
    { plugin: "questions", id: "questions-structured", label: t("Structured questions"), what: t("Decides whether a question is about your data, plans the query over it and phrases the answer from the numbers.") },
  ] as const;
