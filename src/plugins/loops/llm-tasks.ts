import type { T } from "@/lib/i18n/shared";

/** The AI tasks loops has Zeff run (llm plugin: each its own backend and model). Client-safe; found by plugins/llm/tasks.ts through llm-tasks.generated.ts. */
export const LOOPS_LLM_TASKS = (t: T) =>
  [
    { plugin: "loops", id: "loops-close", label: t("Open loops: kept?"), what: t("Reads what came from someone after a promise and proposes closing it when a message shows it was kept — with the quote; you confirm (Open loops plugin).") },
  ] as const;
