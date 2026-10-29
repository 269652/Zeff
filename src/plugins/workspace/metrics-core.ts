import { getSqlite } from "@/db";
import { listTodos } from "@/lib/boards/store";
import { eventsBetween } from "@/lib/calendar/ir";
import { getWeeklyReport, listEntries } from "@/lib/entries";
import { getWeekTargets } from "@/lib/schedule";
import { CHAT_FOLDERS } from "@/lib/mail/shared";
import { currentWeek, isoDate } from "@/lib/week";
import { myNames } from "@/plugins/people/pulse";
import type { MetricProvider } from "./metric-point";

/**
 * Zeff's own Kennzahlen (metric-point.ts) — the numbers of your days it knows anyway: the hours booked, the todos, the
 * mails, the meetings (the promises are the loops plugin's own). Read now.
 */

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const today = () => isoDate(new Date());

/** A meeting is longer than this only as a block of the day (work, sleep, a workshop day): not counted. */
const MEETING_MAX_H = 4;

/**
 * Whether a calendar entry is a meeting: someone else set it up (its organizer isn't you, nor the calendar itself — a
 * Google calendar's own events name your address, an app's its name), or it is an online meeting you set up; not a todo
 * planned in (Zeff's todo calendars), not a block of the day. Pure.
 */
export function isMeeting(e: { organizer?: string; online?: boolean; todoId?: number | null; start: string; end: string; calendar: { name: string; todos: boolean } }, me: string[]): boolean {
  if (e.todoId || e.calendar.todos) return false;
  if ((Date.parse(e.end) - Date.parse(e.start)) / 36e5 > MEETING_MAX_H) return false;
  const org = (e.organizer ?? "").trim().toLowerCase();
  if (!org) return false;
  const mine = org === e.calendar.name.trim().toLowerCase() || me.includes(org);
  return !mine || !!e.online;
}

/** The hours of this week's meetings — two at once counted once, declined and free ones left out. */
function meetingHoursThisWeek(): number | null {
  const w = currentWeek();
  let me: string[] = [];
  try {
    me = myNames();
  } catch {
    // without your names: the calendar's own name still tells
  }
  const events = eventsBetween(`${w.startIso}T00:00`, `${w.endIso}T23:59`, { busy: true }).filter((e) => !e.allDay && !e.cancelled && e.showAs !== "free" && e.response !== "declined" && isMeeting(e, me));
  if (!events.length) return 0;
  const toMin = (s: string) => Date.parse(s) / 60000;
  const spans = events.map((e) => [toMin(e.start), toMin(e.end)] as [number, number]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let total = 0;
  let [cs, ce] = spans[0] ?? [0, 0];
  for (const [s, e] of spans.slice(1)) {
    if (s <= ce) ce = Math.max(ce, e);
    else {
      total += ce - cs;
      [cs, ce] = [s, e];
    }
  }
  return (total + ce - cs) / 60;
}

export const CORE_METRICS: MetricProvider[] = [
  { label: "Stunden diese Woche", unit: "h", what: "The hours booked this week (time entries)", read: () => getWeeklyReport(currentWeek()).total, href: () => "/entries" },
  { label: "Stunden heute", unit: "h", what: "The hours booked today", read: () => sum(listEntries({ from: today(), to: today() }).map((e) => e.hours)), href: () => "/entries" },
  {
    label: "Auslastung",
    unit: "%",
    what: "This week's booked hours of the week's target (your working hours, absences left out)",
    read: () => {
      const w = currentWeek();
      const target = sum(getWeekTargets(w).targets);
      return target > 0 ? (getWeeklyReport(w).total / target) * 100 : null;
    },
    href: () => "/entries",
  },
  { label: "Offene Todos", unit: "", what: "Your open todos (yours to do, not waiting on others)", read: () => listTodos({ status: "open" }).filter((t) => t.owner !== "other").length, href: () => "/todos" },
  { label: "Überfällige Todos", unit: "", what: "Your open todos past their due day", read: () => listTodos({ status: "open" }).filter((t) => t.owner !== "other" && t.due && t.due < today()).length, href: () => "/todos" },
  { label: "Wartet auf andere", unit: "", what: "Open todos where you wait on someone", read: () => listTodos({ status: "open" }).filter((t) => t.owner === "other").length, href: () => "/todos" },
  {
    label: "Ungelesene Mails",
    unit: "",
    what: "Unread mails in your inboxes (archive, sent and chats left out)",
    read: () => {
      try {
        const where = `unread = 1 and resolved_at is null and folder not like '%Archive%' and folder not like '%Archiv%' and folder not like '%Sent%' and folder not like '%Gesendet%' and folder not in (${CHAT_FOLDERS.map((f) => `'${f}'`).join(", ")})`;
        return (getSqlite().prepare(`select count(*) as n from emails where ${where}`).get() as { n: number }).n;
      } catch {
        return null;
      }
    },
  },
  { label: "Meetingstunden diese Woche", unit: "h", what: "The hours of this week's meetings in your calendars — set up by someone else (or online), two at once counted once; todos planned in and day blocks left out", read: meetingHoursThisWeek, href: () => "/calendar" },
];
