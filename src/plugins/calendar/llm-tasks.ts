import type { T } from "@/lib/i18n/shared";

/** The AI tasks the calendar has Zeff run (llm plugin: each its own backend and model). Client-safe; found by plugins/llm/tasks.ts through llm-tasks.generated.ts. */
export const CALENDAR_LLM_TASKS = (t: T) =>
  [
    { plugin: "calendar", id: "calendar-todos", label: t("Appointments to todos"), what: t("Decides which of today's and tomorrow's appointments give you something to do — only those become todos (a blocker like “Pause” doesn't).") },
  ] as const;
