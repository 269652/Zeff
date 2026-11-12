import { t } from "@/lib/i18n/server";
import { ApiError, int, str, type ApiContribution, type Params } from "@/lib/plugins/api-kit";

/**
 * The Calendar plugin's part of the plugin API: the appointments between two days (read) and an appointment in one of Zeff's own
 * calendars (write — study times, reminders). Not marked safe for automations: a flow or a function needs its own permission for it.
 */
export const CALENDAR_API: ApiContribution = {
  permissions: () => ({ "calendar.read": t("Read your appointments"), "calendar.write": t("Add and remove appointments in Zeff's own calendars") }),
  methods: {
    "calendar.events": {
      perm: "calendar.read",
      summary: "The appointments from a day to a day (from, to: YYYY-MM-DD; at most 62 days).",
      run: async (p: Params) => {
        const from = str(p, "from", { required: true, max: 10 });
        const to = str(p, "to", { required: true, max: 10 });
        if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new ApiError("bad_request", "from and to: days as YYYY-MM-DD");
        if ((new Date(to).getTime() - new Date(from).getTime()) / 864e5 > 62) throw new ApiError("bad_request", "at most 62 days at once");
        const { eventsBetween } = await import("@/lib/calendar/ir");
        return eventsBetween(from, to).map((e) => ({ id: e.id, title: e.title, start: e.start, end: e.end, allDay: !!e.allDay, location: e.location ?? "", description: e.description ?? "", calendar: e.calendarId }));
      },
    },
    "calendar.event.delete": {
      perm: "calendar.write",
      summary: "Remove an appointment of Zeff's own calendars (id).",
      run: async (p: Params) => {
        const { deleteEvent } = await import("@/lib/calendar/ir");
        try {
          deleteEvent(int(p, "id", { min: 1, required: true }) as number);
        } catch (err) {
          throw new ApiError("bad_request", err instanceof Error ? err.message : String(err));
        }
        return { deleted: true };
      },
    },
    "calendar.event.add": {
      perm: "calendar.write",
      summary: "An appointment in Zeff's own calendar (title, start, end as local date-times 2026-11-12T18:00; description; calendar: its id, else calendarName: one of Zeff's own by that name, made when there is none, else the first of Zeff's own).",
      run: async (p: Params) => {
        const { addEvent, listCalendars } = await import("@/lib/calendar/ir");
        const own = listCalendars().filter((c) => c.source === "zeff");
        const wanted = int(p, "calendar", { min: 1 });
        const named = str(p, "calendarName", { max: 80 });
        const { createCalendar } = await import("@/lib/calendar/ir");
        const cal = wanted ? own.find((c) => c.id === wanted) : named ? (own.find((c) => c.name.toLowerCase() === named.toLowerCase()) ?? createCalendar(named)) : own[0];
        if (!cal) throw new ApiError("not_found", wanted ? `calendar ${wanted}: not one of Zeff's own` : "there is no calendar of Zeff's own");
        const start = str(p, "start", { required: true, max: 25 });
        const end = str(p, "end", { max: 25 }) || start;
        try {
          const e = addEvent(cal.id, { title: str(p, "title", { required: true, max: 200 }), start, end, description: str(p, "description", { max: 2000 }) || undefined });
          return { id: e.id, title: e.title, start: e.start, end: e.end, calendar: cal.id };
        } catch (err) {
          throw new ApiError("bad_request", err instanceof Error ? err.message : String(err));
        }
      },
    },
  },
};
