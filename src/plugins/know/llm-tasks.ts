import type { T } from "@/lib/i18n/shared";

/** The AI tasks the know plugin has Zeff run (llm plugin: each its own backend and model). Client-safe; found by plugins/llm/tasks.ts through llm-tasks.generated.ts. */
export const KNOW_LLM_TASKS = (t: T) =>
  [
    { plugin: "know", id: "know-summary", label: t("What you should know"), what: t("Sums up in a few points what you should know before a meeting or about a mail, a chat, a ticket, a person — from what Zeff put together about it, each point linked to its source; made before your meetings with the briefing and when you ask, again only when something changed.") },
  ] as const;
