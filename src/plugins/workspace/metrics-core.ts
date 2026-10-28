import { getSqlite } from "@/db";
import { listTodos } from "@/lib/boards/store";
import { eventsBetween } from "@/lib/calendar/ir";
import { getWeeklyReport, listEntries } from "@/lib/entries";
import { getWeekTargets } from "@/lib/schedule";
import { currentWeek, isoDate } from "@/lib/week";
import type { MetricProvider } from "./metric-point";

/**
 * Zeff's own Kennzahlen (metric-point.ts) — the numbers of your days it knows anyway: the hours booked, the todos, the
 * mails, the meetings (the promises are the loops plugin's own). Read now.
 */

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const today = () => isoDate(new Date());

/** The hours of this week's meetings — two at once counted once, declined and free ones left out. */
function meetingHoursThisWeek(): number | null {
  const w = currentWeek();
  const events = eventsBetween(`${w.startIso}T00:00`, `${w.endIso}T23:59`, { busy: true }).filter((e) => !e.allDay && !e.cancelled && e.showAs !== "free" && e.response !== "declined");
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
    what: "Unread mails in your inboxes (archive and sent left out)",
    read: () => {
      try {
        const where = "unread = 1 and resolved_at is null and folder not like '%Archive%' and folder not like '%Archiv%' and folder not like '%Sent%' and folder not like '%Gesendet%'";
        return (getSqlite().prepare(`select count(*) as n from emails where ${where}`).get() as { n: number }).n;
      } catch {
        return null;
      }
    },
  },
  { label: "Meetingstunden diese Woche", unit: "h", what: "The hours of this week's meetings in your calendars (two at once counted once)", read: meetingHoursThisWeek, href: () => "/calendar" },
];
