import type { T } from "@/lib/i18n/shared";

/** The AI tasks people has Zeff run (llm plugin: each its own backend and model). Client-safe; found by plugins/llm/tasks.ts through llm-tasks.generated.ts. */
export const PEOPLE_LLM_TASKS = (t: T) =>
  [
    { plugin: "people", id: "people-dates", label: t("People's dates"), what: t("Finds birthdays, anniversaries and other important dates of your people in the knowledge and in your messages (People plugin).") },
    { plugin: "people", id: "people-normalize", idempotent: true, label: t("People matching"), what: t("Finds who is meant by the names in your todos — one person under all their names: aliases, new profiles for contacts, duplicates merged (People plugin).") },
    { plugin: "people", id: "people-classify", idempotent: true, label: t("People: person or organisation"), what: t("Says of each contact whether it is a person or an organisation, and their circle — family, friends, work, authorities, services (People plugin).") },
    { plugin: "people", id: "people-compile", label: t("People summaries"), what: t("Writes a summary of each person from everything Zeff has on them — what connects you, key facts, fun facts (People plugin).") },
    { plugin: "people", id: "people-extract", label: t("People facts from messages"), what: t("Reads what new messages say about your people — roles, preferences, commitments, who reports to whom (People plugin).") },
    { plugin: "people", id: "people-import", label: t("People import"), what: t("Goes through what came in lately and says who the real people in it are, with their other names, addresses and accounts (People plugin).") },
    { plugin: "people", id: "people-greeting", label: t("Greetings"), what: t("Drafts a birthday greeting for someone of your people, in your tone, from what Zeff knows of them — you send it yourself (People plugin).") },
  ] as const;
