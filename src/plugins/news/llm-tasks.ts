import type { T } from "@/lib/i18n/shared";

/** The AI tasks news has Zeff run (llm plugin: each its own backend and model). Client-safe; found by plugins/llm/tasks.ts through llm-tasks.generated.ts. */
export const NEWS_LLM_TASKS = (t: T) =>
  [
    { plugin: "news", id: "news-digest", idempotent: true, label: t("News overview"), what: t("Sums up the best unread news of the day for you and says why each pick fits (News plugin).") },
    { plugin: "news", id: "news-feeds", label: t("News feed finder"), what: t("Names outlets, blogs and newsletters worth reading on a topic — Zeff then looks for their feeds and checks them (News plugin).") },
  ] as const;
