import { eventsBetween } from "@/lib/calendar/ir";
import { formatTime } from "@/lib/format";
import { t } from "@/lib/i18n/server";
import { listBadge, type WidgetItem, type WorkspaceWidget, type WidgetSetting } from "@/plugins/workspace/widget-point";

const day = (d: Date) => d.toLocaleDateString("sv-SE");

/** What is in the calendar today (still to come) and tomorrow — the next appointments at a glance. */
export const CALENDAR_WIDGETS: WorkspaceWidget[] = [
  {
    id: "calendar.agenda",
    get label() {
      return t("Today and tomorrow");
    },
    icon: "📅",
    get description() {
      return t("Your next appointments — what is still to come today, and tomorrow — with where and when.");
    },
    get settings(): WidgetSetting[] {
      return [
        { key: "days", label: t("Days ahead"), kind: "number", default: 2, min: 1, max: 60 },
        { key: "q", label: t("Words (title, place, people)"), kind: "text", default: "" },
        { key: "calendar", label: t("Calendar (its name; empty: all)"), kind: "text", default: "" },
        { key: "limit", label: t("How many"), kind: "number", default: 12, min: 1, max: 50 },
      ];
    },
    ttl: 60,
    data: async (config) => {
      const now = new Date();
      const today = day(now);
      const end = new Date(now);
      end.setDate(end.getDate() + Number(config.days));
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      // Only some (an old appointments block's words or calendar): by words in the title, the place or who comes; by the calendar's name.
      const q = String(config.q ?? "").trim().toLowerCase();
      const cal = String(config.calendar ?? "").trim().toLowerCase();
      const events = eventsBetween(`${today}T00:00`, `${day(end)}T00:00`, { visible: true, proposals: true })
        .filter((e) => !e.cancelled && (e.allDay ? e.end > today : new Date(e.end) > now))
        .filter((e) => (!q || `${e.title} ${e.location} ${e.attendees.join(" ")}`.toLowerCase().includes(q)) && (!cal || e.calendar.name.toLowerCase() === cal))
        .sort((a, b) => (a.allDay === b.allDay ? a.start.localeCompare(b.start) : a.allDay ? -1 : 1) || a.start.localeCompare(b.start));
      const { calendarDatabase } = await import("@/plugins/workspace/calendar-database");
      const db = calendarDatabase();
      const href = (d: string) => (db ? `/workspace/${db}?v=day&d=${d}` : "/calendar");
      const when = (d: string) => (d === today ? t("today") : d === day(tomorrow) ? t("tomorrow") : new Date(`${d}T12:00`).toLocaleDateString(undefined, { weekday: "short" }));
      const items = events.slice(0, Number(config.limit) || 12).map((e): WidgetItem => {
        const d = e.start.slice(0, 10);
        const running = !e.allDay && new Date(e.start) <= now;
        return {
          id: `${e.id}:${e.occurrence ?? ""}`,
          // A proposed one (the day plan's block, an assistant's plan): said so, accepted or dismissed from its row.
          icon: e.proposed ? "◌" : e.allDay ? "🗓️" : e.online ? "💻" : "🕑",
          text: e.proposed ? t("Proposed: {title}", { title: e.title || t("(no title)") }) : e.title || t("(no title)"),
          ...(e.proposed
            ? {
                actions: [
                  { id: "accept", label: t("Accept"), icon: "✓" },
                  { id: "dismiss", label: t("Dismiss"), icon: "✕" },
                ],
              }
            : {}),
          detail: [when(d), e.allDay ? t("all day") : `${formatTime(e.start)}–${formatTime(e.end)}`, e.location].filter(Boolean).join(" · "),
          meta: running ? t("now") : e.allDay ? undefined : formatTime(e.start),
          tone: running ? "good" : undefined,
          href: href(d),
        };
      });
      return { kind: "list", items, count: events.filter((e) => !e.proposed && e.start.slice(0, 10) === today).length || undefined, empty: t("Nothing in the calendar."), footer: { text: t("Open the calendar"), href: href(today) } };
    },
    // A proposed appointment's buttons: decided through its proposal (as the calendar's own buttons).
    act: async (action, payload) => {
      if (action !== "accept" && action !== "dismiss") throw new Error("unknown action");
      const id = Number(String(payload.id ?? "").split(":")[0]);
      const p = (await import("@/lib/calendar/proposed")).proposalOfEvent(id);
      if (!p) throw new Error(t("That appointment is gone."));
      await (await import("@/lib/proposals")).decide(p.id, action === "accept" ? "accepted" : "dismissed");
    },
    // The page's badge: a dot while appointments are still to come today.
    badge: listBadge({ activity: (n) => (n === 1 ? t("1 appointment today") : t("{n} appointments today", { n })) }),
  },
];
