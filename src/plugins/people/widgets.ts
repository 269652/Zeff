import { t } from "@/lib/i18n/server";
import type { WorkspaceWidget, WidgetSetting } from "@/plugins/workspace/widget-point";
import { initials } from "@/plugins/workspace/widget-shared";
import { inDaysText, upcomingTitle } from "./shared";
import { markReminded, upcomingOpen } from "./store";

/** The dates of your people coming up (birthdays, anniversaries) — "done" for this time takes one off. */
export const PEOPLE_WIDGETS: WorkspaceWidget[] = [
  {
    id: "people.upcoming",
    get label() {
      return t("Dates coming up");
    },
    icon: "🎂",
    get description() {
      return t("Birthdays and dates of your people in the next days — tick one off when you have thought of it.");
    },
    get settings(): WidgetSetting[] {
      return [
        { key: "days", label: t("Days ahead"), kind: "number", default: 14, min: 1, max: 90 },
        { key: "limit", label: t("How many"), kind: "number", default: 6, min: 1, max: 20 },
      ];
    },
    ttl: 60,
    data: async (config) => {
      const { personHref } = await import("@/plugins/workspace/people-database");
      const all = upcomingOpen(Number(config.days));
      const items = all.slice(0, Number(config.limit)).map((u) => ({
        id: `${u.date.id}:${u.on}`,
        icon: u.date.kind === "birthday" ? "🎂" : initials(u.person.name) || "📅",
        text: upcomingTitle(u, t),
        meta: inDaysText(u.inDays, u.on, t),
        tone: u.inDays <= 1 ? ("warn" as const) : undefined,
        href: personHref(u.person.id),
        actions: [{ id: "reminded", label: t("Thought of it"), icon: "✓" }],
      }));
      return { kind: "list", items, count: all.length || undefined, empty: t("Nothing coming up.") };
    },
    act: (action, payload) => {
      if (action !== "reminded") throw new Error("unknown action");
      const [dateId, on] = payload.id.split(":");
      markReminded(Number(dateId), on);
    },
  },
];
