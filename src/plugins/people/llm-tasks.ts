import type { T } from "@/lib/i18n/shared";

/** The AI tasks people has Zeff run (llm plugin: each its own backend and model). Client-safe; found by plugins/llm/tasks.ts through llm-tasks.generated.ts. */
export const PEOPLE_LLM_TASKS = (t: T) =>
  [
    { plugin: "people", id: "people-dates", label: t("People's dates"), what: t("Finds birthdays, anniversaries and other important dates of your people in the knowledge and in your messages (People plugin).") },
    { plugin: "people", id: "people-normalize", idempotent: true, label: t("People matching"), what: t("Finds who is meant by the names in your todos — one person under all their names: aliases, new profiles for contacts, duplicates merged (People plugin).") },
  ] as const;
