import type { T } from "@/lib/i18n/shared";

/** The AI tasks the Notebook has Zeff run (llm plugin: each its own backend and model). Client-safe; found by plugins/llm/tasks.ts through llm-tasks.generated.ts. */
export const NOTEBOOK_LLM_TASKS = (t: T) =>
  [{ plugin: "notebook", id: "notebook-code", label: t("Code for a code cell"), what: t("Writes or changes the code of a code cell from what you describe — in the cell's language, with its inputs and Zeff's functions in mind (Notebook).") }, { plugin: "notebook", id: "notebook-ask", label: t("Questions from code"), what: t("What code cells and plugin functions ask the AI with zeff.ai (Notebook) — only when you allowed it.") }] as const;
