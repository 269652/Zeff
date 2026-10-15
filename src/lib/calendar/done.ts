import { listEntries } from "@/lib/entries";
import { endOf, normalizeStart } from "@/lib/entry-timeline";
import { fromMinutes, toMinutes } from "@/lib/pauses-shared";
import { listPausesByDate } from "@/lib/pauses";
import { t } from "@/lib/i18n/server";
import { ensureCalendar, replaceEvents, type EventInput } from "./ir";

/** The key of the calendar of what is done (derived: Zeff writes it, nothing there is entered by hand). */
export const DONE_CALENDAR_KEY = "zeff:done";

/**
 * The "Done" calendar: every entry that has a start time as an appointment of its own — when the work
 * began, as long as it really took (what a group's tasks worked, a collecting entry's total), the
 * day's breaks inside it. A calendar of what happened, beside the ones of what is planned: not busy
 * (it blocks no free time), no booking, no todos. Read again from the entries each time it is looked at,
 * for the period shown. `from`/`to`: days "YYYY-MM-DD", `to` exclusive.
 */
export function syncDoneCalendar(from: string, to: string): void {
  const cal = ensureCalendar(DONE_CALENDAR_KEY, { source: "zeff", name: "Done", color: "#10b981", busy: false, book: false, todos: false });
  const last = new Date(new Date(`${to}T00:00:00`).getTime() - 864e5);
  const lastDay = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`;
  const events: EventInput[] = [];
  for (const e of listEntries({ from, to: lastDay })) {
    const start = normalizeStart(e.start);
    if (!start) continue;
    // What it really took: a task of a group its worked hours, a collecting entry its total, else what it books.
    const hours = e.workedHours ?? e.hours;
    if (!(hours > 0)) continue;
    const breaks = listPausesByDate(e.date, e.date)[e.date] ?? [];
    const end = Math.min(23 * 60 + 59, endOf(toMinutes(start), Math.round(hours * 60), breaks));
    const books = e.hours !== hours ? ` · ${t("{hours} h booked", { hours: e.hours })}` : "";
    events.push({
      key: `entry:${e.id}`,
      title: `${e.ticket ? `${e.ticket}: ` : ""}${e.description}`,
      start: `${e.date}T${start}`,
      end: `${e.date}T${fromMinutes(end)}`,
      description: `${e.project?.title ?? e.job.name} · ${hours} h${books}`,
      showAs: "free",
      url: `/entries/${e.id}`,
    });
  }
  replaceEvents(cal.id, events, { from, to });
}
