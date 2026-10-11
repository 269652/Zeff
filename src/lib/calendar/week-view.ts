import { isoDate, type WeekInfo } from "@/lib/week";
import { bookableGraphEvents } from "./ir";
import { isExcludedMeeting, jobForMeeting, planImport, type BookedEntry, type Meeting, type MeetingJobRule } from "./meetings";

/**
 * Where a calendar event stands for importing:
 * - importable: over, not booked yet — ticked unless flagged (excluded, tentative, free, private)
 * - booked: an entry already carries it
 * - later: today, but not over yet — can be ticked by hand
 * - upcoming: a later day — not importable yet
 * - all-day / cancelled / declined / too-long: shown, never imported
 */
export type CalendarEventState = "importable" | "booked" | "later" | "upcoming" | "all-day" | "cancelled" | "declined" | "too-long";

export type CalendarEvent = Meeting & {
  state: CalendarEventState;
  /** The job it's booked on: the first matching meeting→job rule, else "All other meetings". */
  jobNumber: string;
};

export type CalendarDay = { date: string; allDay: CalendarEvent[]; events: CalendarEvent[] };

/**
 * The week's synced Outlook events (from the meeting inbox), day by day, each with its import
 * state, default selection and job — the Calendar tab's model.
 */
export function getCalendarWeek(
  week: WeekInfo,
  opts: { now: Date; booked: BookedEntry[]; excludeRules: string[]; jobRules: MeetingJobRule[]; defaultJob: string },
): CalendarDay[] {
  // The calendars set for booking, from Zeff's calendar model (Outlook's by default).
  const events = bookableGraphEvents().filter((e) => {
    const day = e.start.dateTime.slice(0, 10);
    return day >= week.startIso && day <= week.endIso;
  });
  const plan = planImport(events, { from: week.startIso, to: week.endIso, now: opts.now, booked: opts.booked, excludeRules: opts.excludeRules });
  const today = isoDate(opts.now);
  const job = (m: Meeting) => jobForMeeting(m.subject, opts.jobRules) ?? opts.defaultJob;

  const all: CalendarEvent[] = plan.meetings.map((m) => ({
    ...m,
    state: m.flags.includes("imported") ? "booked" : "importable",
    selected: m.selected && !m.flags.includes("imported"),
    jobNumber: job(m),
  }));
  for (const { meeting: m, reason } of plan.excluded) {
    let state: CalendarEventState;
    if (reason === "not-finished") state = m.date <= today ? "later" : "upcoming";
    else if (reason === "all-day" || reason === "cancelled" || reason === "declined" || reason === "too-long") state = reason;
    else continue; // working-location blocks, other weeks
    if (state === "later" && isExcludedMeeting(m.subject, opts.excludeRules)) m.flags.push("excluded");
    all.push({ ...m, state, selected: false, jobNumber: job(m) });
  }

  return week.days.map((d) => {
    const date = isoDate(d);
    const day = all.filter((e) => e.date === date);
    return {
      date,
      allDay: day.filter((e) => e.state === "all-day"),
      events: day.filter((e) => e.state !== "all-day").sort((a, b) => a.startTime.localeCompare(b.startTime) || a.endTime.localeCompare(b.endTime)),
    };
  });
}
