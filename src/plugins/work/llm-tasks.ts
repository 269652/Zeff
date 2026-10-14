import type { T } from "@/lib/i18n/shared";

/** The AI tasks work has Zeff run (llm plugin: each its own backend and model). Client-safe; found by plugins/llm/tasks.ts through llm-tasks.generated.ts. */
export const WORK_LLM_TASKS = (t: T) =>
  [
    { plugin: "work", id: "worker", label: t("Worker"), what: t("Works on a todo (Work tab, ✨ To Copilot) — in the repo, with tools.") },
  ] as const;
