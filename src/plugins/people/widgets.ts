import { t } from "@/lib/i18n/server";
import type { WorkspaceWidget, WidgetSetting } from "@/plugins/workspace/widget-point";
import { initials } from "@/plugins/workspace/widget-shared";
import { inDaysText, upcomingTitle } from "./shared";
import { markReminded, upcomingOpen } from "./store";
import { openCommitments, reviewClaim } from "./graph";

/** The dates of your people coming up (birthdays, anniversaries) — "done" for this time takes one off; who owes whom; the briefs before an appointment; who you are drifting apart from. */
export const PEOPLE_WIDGETS: WorkspaceWidget[] = [
  {
    id: "people.list",
    get label() {
      return t("People");
    },
    icon: "👥",
    get description() {
      return t("People at a glance — your starred ones, the ones picked, or by words — with how to reach them and their next date.");
    },
    get settings(): WidgetSetting[] {
      return [
        { key: "q", label: t("Words (name, alias, mail)"), kind: "text", default: "" },
        { key: "limit", label: t("How many"), kind: "number", default: 8, min: 1, max: 30 },
        // (the people an old people block had picked: their ids)
        { key: "ids", label: "ids", kind: "text", default: "", hidden: true },
      ];
    },
    ttl: 60,
    data: async (config) => {
      const { listPeople, upcoming } = await import("./store");
      const { peopleHome, personHrefs } = await import("@/plugins/workspace/people-database");
      const q = String(config.q ?? "").trim().toLowerCase();
      const ids = new Set(String(config.ids ?? "").split(",").map(Number).filter((n) => n > 0));
      const soonest = new Map<number, { on: string; kind: string }>();
      for (const u of upcoming({ days: 366 }).sort((a, b) => a.on.localeCompare(b.on))) if (!soonest.has(u.person.id)) soonest.set(u.person.id, { on: u.on, kind: u.date.kind === "other" ? u.date.label || "" : u.date.kind });
      // The ones picked, or by words; neither: your starred ones.
      const all = listPeople().filter((p) => (ids.size ? ids.has(p.id) : true) && (!q || `${p.name} ${p.aliases.join(" ")} ${p.emails.join(" ")}`.toLowerCase().includes(q)) && (ids.size || q || p.starred));
      const hrefs = personHrefs();
      const items = all.slice(0, Number(config.limit) || 8).map((p) => {
        const next = soonest.get(p.id);
        return {
          id: String(p.id),
          icon: initials(p.name) || "👤",
          text: p.name,
          detail: p.emails.slice(0, 2).join(" · ") || undefined,
          meta: next ? `${next.kind === "birthday" ? "🎂 " : ""}${new Date(`${next.on}T12:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : undefined,
          badge: p.starred ? "★" : undefined,
          href: hrefs[p.id] ?? peopleHome(),
        };
      });
      return { kind: "list", items, count: all.length || undefined, empty: ids.size || q ? t("Nobody found.") : t("No starred people yet — star someone on their page.") };
    },
  },
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
  {
    id: "people.drifting",
    get label() {
      return t("Drifting apart");
    },
    icon: "🌊",
    get description() {
      return t("The people you are in touch with less than usual: their usual rhythm over the last 12 months, and how long it has been now — twice that and more.");
    },
    get settings(): WidgetSetting[] {
      return [{ key: "limit", label: t("How many"), kind: "number", default: 6, min: 1, max: 20 }];
    },
    // Reads a year of messages per person: not every minute.
    ttl: 900,
    data: async (config) => {
      const { personHref } = await import("@/plugins/workspace/people-database");
      const { driftingPeople } = await import("./pulse-insights");
      const all = await driftingPeople();
      const items = all.slice(0, Number(config.limit ?? 6)).map((x) => ({
        id: String(x.personId),
        icon: initials(x.name) || "🌊",
        text: x.name,
        detail: t("usually every {n} days, now {m} days", { n: Math.round(x.typicalGap * 10) / 10, m: x.daysSince }),
        meta: new Date(`${x.lastDay}T12:00:00`).toLocaleDateString(),
        tone: x.drift >= 4 ? ("warn" as const) : undefined,
        href: personHref(x.personId),
      }));
      return { kind: "list", items, count: all.length || undefined, empty: t("Nobody drifting — you are in touch with your people as usual.") };
    },
  },
];
