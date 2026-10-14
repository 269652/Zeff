import type { T } from "@/lib/i18n/shared";

/** The AI tasks auto-actions has Zeff run (llm plugin: each its own backend and model). Client-safe; found by plugins/llm/tasks.ts through llm-tasks.generated.ts. */
export const AUTO_ACTIONS_LLM_TASKS = (t: T) =>
  [
    { plugin: "auto-actions", id: "auto-actions", label: t("Auto actions"), what: t("Turns todos into ready-made actions (message, comment, mail, meeting, hand-over).") },
  ] as const;
