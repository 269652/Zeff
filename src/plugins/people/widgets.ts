import { t } from "@/lib/i18n/server";
import type { WorkspaceWidget, WidgetSetting } from "@/plugins/workspace/widget-point";
import { initials } from "@/plugins/workspace/widget-shared";
import { inDaysText, upcomingTitle } from "./shared";
import { markReminded, upcomingOpen } from "./store";
import { openCommitments, reviewClaim } from "./graph";

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
  {
    id: "people.owed",
    get label() {
      return t("Who owes whom");
    },
    icon: "🤝",
    get description() {
      return t("The commitments read from your messages: what you owe your people, what they owe you — past its day first; tick one off when it is kept.");
    },
    get settings(): WidgetSetting[] {
      return [
        {
          key: "who",
          label: t("Whose"),
          kind: "select",
          default: "all",
          options: [
            { value: "all", label: t("Both") },
            { value: "mine", label: t("What I owe") },
            { value: "theirs", label: t("What they owe me") },
          ],
        },
        { key: "person", label: t("Only with (a name; empty: everyone)"), kind: "text", default: "" },
        { key: "limit", label: t("How many"), kind: "number", default: 8, min: 1, max: 30 },
      ];
    },
    ttl: 60,
    data: async (config) => {
      const { personHref } = await import("@/plugins/workspace/people-database");
      const who = String(config.who ?? "all");
      const only = String(config.person ?? "").trim().toLowerCase();
      const today = new Date().toISOString().slice(0, 10);
      const all = openCommitments().filter((c) => (who === "all" || c.direction === who) && (!only || c.personName.toLowerCase().includes(only)));
      const items = all.slice(0, Number(config.limit ?? 8)).map((c) => ({
        id: String(c.id),
        icon: initials(c.personName) || "🤝",
        text: c.text,
        detail: `${c.personName} · ${c.direction === "mine" ? t("you owe") : t("they owe")}`,
        meta: c.due || undefined,
        tone: c.due && c.due < today ? ("bad" as const) : undefined,
        href: personHref(c.personId),
        actions: [{ id: "done", label: t("Kept"), icon: "✓" }],
      }));
      return { kind: "list", items, count: all.length || undefined, empty: t("Nothing owed.") };
    },
    act: (action, payload) => {
      if (action !== "done") throw new Error("unknown action");
      reviewClaim(Number(payload.id), "done");
    },
  },
  {
    id: "people.briefs",
    get label() {
      return t("Meeting briefs");
    },
    icon: "🗒️",
    get description() {
      return t("Your appointments in the next 24 hours, a line for each person in them: when you last met, what came from them since, what is open between you.");
    },
    get settings(): WidgetSetting[] {
      return [{ key: "limit", label: t("How many"), kind: "number", default: 6, min: 1, max: 20 }];
    },
    ttl: 120,
    data: async (config) => {
      const { personHref } = await import("@/plugins/workspace/people-database");
      const { meetingBriefs } = await import("./pulse");
      const briefs = await meetingBriefs();
      const time = (iso: string) => (iso.length > 10 ? new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : t("all day"));
      const items = briefs.slice(0, Number(config.limit ?? 6)).map((b) => ({
        id: `${b.eventId}:${b.personId}`,
        icon: initials(b.name) || "🗒️",
        text: `${b.name} — ${b.title}`,
        detail:
          [
            b.lastMet ? t("last met {date}", { date: new Date(b.lastMet).toLocaleDateString() }) : t("first meeting"),
            b.since.length ? t("{n} messages since", { n: b.since.length }) : "",
            b.owed.length ? t("{n} open between you", { n: b.owed.length }) : "",
            b.cases.length ? t("{n} cases", { n: b.cases.length }) : "",
          ]
            .filter(Boolean)
            .join(" · ") || undefined,
        meta: time(b.start),
        tone: b.owed.some((o) => o.due && o.due < new Date().toISOString().slice(0, 10)) ? ("warn" as const) : undefined,
        href: personHref(b.personId),
      }));
      return { kind: "list", items, count: briefs.length || undefined, empty: t("No appointments with your people in the next 24 hours.") };
    },
  },
];
