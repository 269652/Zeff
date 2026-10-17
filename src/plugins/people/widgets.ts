import { t } from "@/lib/i18n/server";
import type { WorkspaceWidget } from "@/plugins/workspace/widget-point";
import { inDaysText, upcomingTitle } from "./shared";
import { markReminded, upcomingOpen } from "./store";

/** The dates of your people coming up (birthdays, anniversaries) — "done" for this time takes one off. */
export const PEOPLE_WIDGETS: WorkspaceWidget[] = [
  {
    id: "people.upcoming",
    label: "Dates coming up",
    icon: "🎂",
    description: "Birthdays and dates of your people in the next days — tick one off when you have thought of it.",
    settings: [
      { key: "days", label: "Days ahead", kind: "number", default: 14, min: 1, max: 90 },
      { key: "limit", label: "How many", kind: "number", default: 6, min: 1, max: 20 },
    ],
    ttl: 60,
    data: async (config) => {
      const { personHref } = await import("@/plugins/workspace/people-database");
      const items = upcomingOpen(Number(config.days))
        .slice(0, Number(config.limit))
        .map((u) => ({ id: `${u.date.id}:${u.on}`, text: upcomingTitle(u, t), detail: inDaysText(u.inDays, u.on, t), href: personHref(u.person.id), actions: [{ id: "reminded", label: t("Done") }] }));
      return { kind: "list", items, empty: t("Nothing coming up.") };
    },
    act: (action, payload) => {
      if (action !== "reminded") throw new Error("unknown action");
      const [dateId, on] = payload.id.split(":");
      markReminded(Number(dateId), on);
    },
  },
];
