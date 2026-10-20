import type { T } from "@/lib/i18n/shared";

/** The AI tasks cases has Zeff run (llm plugin: each its own backend and model). Client-safe; found by plugins/llm/tasks.ts through llm-tasks.generated.ts. */
export const CASES_LLM_TASKS = (t: T) =>
  [{ plugin: "cases", id: "cases-compile", idempotent: true, label: t("Case summaries"), what: t("Sums up each case from its mails, letters and todos: what it is about, the money, the next payment or deadline and where to pay (Cases plugin).") }] as const;
