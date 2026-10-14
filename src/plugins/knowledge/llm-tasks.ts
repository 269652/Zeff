import type { T } from "@/lib/i18n/shared";

/** The AI tasks knowledge has Zeff run (llm plugin: each its own backend and model). Client-safe; found by plugins/llm/tasks.ts through llm-tasks.generated.ts. */
export const KNOWLEDGE_LLM_TASKS = (t: T) =>
  [
    { plugin: "knowledge", id: "knowledge-relations", idempotent: true, label: t("Knowledge matching"), what: t("Picks from the knowledge base's hits what really fits each todo.") },
  ] as const;
