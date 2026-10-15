import type { T } from "@/lib/i18n/shared";

/** The AI tasks llm has Zeff run (llm plugin: each its own backend and model). Client-safe; found by plugins/llm/tasks.ts through llm-tasks.generated.ts. */
export const LLM_LLM_TASKS = (t: T) =>
  [
    { plugin: "llm", id: "general", label: t("Other"), what: t("Everything else (e.g. the connection test).") },
  ] as const;
