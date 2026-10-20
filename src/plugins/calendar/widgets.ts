import { eventsBetween } from "@/lib/calendar/ir";
import { formatTime } from "@/lib/format";
import { t } from "@/lib/i18n/server";
import type { WidgetItem, WorkspaceWidget, WidgetSetting } from "@/plugins/workspace/widget-point";

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
      return [{ key: "days", label: t("Days ahead"), kind: "number", default: 2, min: 1, max: 7 }];
    },
    ttl: 60,
    data: async (config) => {
      const now = new Date();
      const today = day(now);
      const end = new Date(now);
      end.setDate(end.getDate() + Number(config.days));
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const events = eventsBetween(`${today}T00:00`, `${day(end)}T00:00`, { visible: true })
        .filter((e) => !e.cancelled && (e.allDay ? e.end > today : new Date(e.end) > now))
        .sort((a, b) => (a.allDay === b.allDay ? a.start.localeCompare(b.start) : a.allDay ? -1 : 1) || a.start.localeCompare(b.start));
      const { calendarDatabase } = await import("@/plugins/workspace/calendar-database");
      const db = calendarDatabase();
      const href = (d: string) => (db ? `/workspace/${db}?v=day&d=${d}` : "/calendar");
      const when = (d: string) => (d === today ? t("today") : d === day(tomorrow) ? t("tomorrow") : new Date(`${d}T12:00`).toLocaleDateString(undefined, { weekday: "short" }));
      const items = events.slice(0, 12).map((e): WidgetItem => {
        const d = e.start.slice(0, 10);
        const running = !e.allDay && new Date(e.start) <= now;
        return {
          id: `${e.id}:${e.occurrence ?? ""}`,
          icon: e.allDay ? "🗓️" : e.online ? "💻" : "🕑",
          text: e.title || t("(no title)"),
          detail: [when(d), e.allDay ? t("all day") : `${formatTime(e.start)}–${formatTime(e.end)}`, e.location].filter(Boolean).join(" · "),
          meta: running ? t("now") : e.allDay ? undefined : formatTime(e.start),
          tone: running ? "good" : undefined,
          href: href(d),
        };
      });
      return { kind: "list", items, count: events.filter((e) => e.start.slice(0, 10) === today).length || undefined, empty: t("Nothing in the calendar."), footer: { text: t("Open the calendar"), href: href(today) } };
    },
  },
];
