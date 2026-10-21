import { isInstalled } from "@/plugins/state";
import type { CalendarEventView } from "@/lib/calendar/ir-shared";
import type { Person } from "./shared";
import { getPerson, namesThem } from "./store";

/**
 * A person's appointments (the People plugin with the Calendar): the coming ones (next 30 days) and the
 * recent ones (last 30 days) where they are an attendee or the organizer — by an address of theirs or
 * their name — or are named in the title or the description. Server only.
 */

export type Appointment = { id: number; title: string; start: string; end: string; allDay: boolean; location: string; calendar: string; color: string; href: string };
export type PersonAppointments = { upcoming: Appointment[]; recent: Appointment[] };

const DAYS = 30;
const LIMIT = 8;
const pad = (n: number) => String(n).padStart(2, "0");
/** A local time as the calendar keeps it: "YYYY-MM-DDTHH:MM". */
const local = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const shift = (d: Date, days: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
};
/** An all-day end ("YYYY-MM-DD", the day after) compared as the start of that day. */
const at = (s: string) => (s.length === 10 ? `${s}T00:00` : s);

/** Whether an appointment is with them: an attendee or the organizer (an address of theirs, or their name), or named in it. */
export function withThem(p: Person, e: Pick<CalendarEventView, "title" | "description" | "attendees" | "organizer">): boolean {
  const mails = p.emails.map((m) => m.trim().toLowerCase()).filter(Boolean);
  const people = [...e.attendees, e.organizer].filter(Boolean);
  if (people.some((a) => mails.some((m) => a.toLowerCase().includes(m)) || namesThem(p, a))) return true;
  return namesThem(p, `${e.title}\n${e.description}`);
}

/** Of these appointments, those with them: upcoming (running or to come, the soonest first) and recent (over, the latest first). */
export function appointmentsWith<E extends Pick<CalendarEventView, "title" | "description" | "attendees" | "organizer" | "start" | "end" | "cancelled">>(p: Person, events: E[], now = new Date()): { upcoming: E[]; recent: E[] } {
  const [from, nowAt, to] = [local(shift(now, -DAYS)), local(now), local(shift(now, DAYS))];
  const mine = events.filter((e) => !e.cancelled && withThem(p, e));
  return {
    upcoming: mine.filter((e) => at(e.end) > nowAt && at(e.start) < to).sort((a, b) => at(a.start).localeCompare(at(b.start))).slice(0, LIMIT),
    recent: mine.filter((e) => at(e.end) <= nowAt && at(e.end) >= from).sort((a, b) => at(b.start).localeCompare(at(a.start))).slice(0, LIMIT),
  };
}

/** Their appointments from the calendars Zeff keeps — null without the Calendar plugin. */
export async function appointmentsOf(personId: number, now = new Date()): Promise<PersonAppointments | null> {
  if (!isInstalled("calendar")) return null;
  const p = getPerson(personId);
  if (!p) return null;
  const { eventsBetween } = await import("@/lib/calendar/ir");
  const found = appointmentsWith(p, eventsBetween(local(shift(now, -DAYS)), local(shift(now, DAYS))), now);
  // Where a day opens: the Workspace's calendar database, else the calendar's own page.
  const db = isInstalled("workspace") ? (await import("@/plugins/workspace/calendar-database")).calendarDatabase() : null;
  const view = (e: (typeof found.upcoming)[number]): Appointment => {
    const day = e.start.slice(0, 10);
    return { id: e.id, title: e.title, start: e.start, end: e.end, allDay: e.allDay, location: e.location, calendar: e.calendar.name, color: e.calendar.color, href: db ? `/workspace/${db}?v=day&d=${day}` : `/kalender?v=day&d=${day}` };
  };
  return { upcoming: found.upcoming.map(view), recent: found.recent.map(view) };
}
