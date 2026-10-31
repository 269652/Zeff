import type { T } from "@/lib/i18n/shared";

/** The AI tasks the workspace has Zeff run (llm plugin: each its own backend and model). Client-safe; found by plugins/llm/tasks.ts through llm-tasks.generated.ts. */
export const WORKSPACE_LLM_TASKS = (t: T) =>
  [
    { plugin: "workspace", id: "ai-filter", idempotent: true, label: t("AI filter"), what: t("Decides for each record of a pipeline whether it stays, by the filter's condition, with a reason (Workspace).") },
    { plugin: "workspace", id: "ai-field", label: t("AI fields"), what: t("Fills a database's AI fields for each row that changed, from its title, cells and page (Workspace).") },
    { plugin: "workspace", id: "pipeline-summary", label: t("AI summary of a database"), what: t("One summary over all rows of a database, by the pipeline step's instruction (Workspace).") },
    { plugin: "workspace", id: "editor-ai", label: t("Writing help (pages)"), what: t("Writes or rewrites text in a page at your request (Workspace).") },
    { plugin: "workspace", id: "page-todos", label: t("Todos from a page"), what: t("Finds the todos a page asks of you (Workspace).") },
    { plugin: "workspace", id: "workspace-ask", label: t("Questions to the workspace"), what: t("Answers a question from the pages that fit, naming them (Workspace).") },
    { plugin: "workspace", id: "page-assist", label: t("Think along (pages)"), what: t("“✨ Think along” on a page: understands what a block is about, asks what is missing and proposes what to set up (a plan calendar, todos, widgets, text).") },
  ] as const;
