import type { T } from "@/lib/i18n/shared";

/** The AI tasks the workspace has Zeff run (llm plugin: each its own backend and model). Client-safe; found by plugins/llm/tasks.ts through llm-tasks.generated.ts. */
export const WORKSPACE_LLM_TASKS = (t: T) =>
  [
    { plugin: "workspace", id: "page-assist", label: t("Think along (pages)"), what: t("“✨ Think along” on a page: understands what a block is about, asks what is missing and proposes what to set up (a plan calendar, todos, widgets, text).") },
  ] as const;
