import { createHash } from "node:crypto";
import { addEvent, deleteEvent, deleteOccurrence, eventById, eventsBetween, updateEvent, updateOccurrence, zeffCalendar } from "@/lib/calendar/ir";
import { dayOf, SOURCE_LABELS, stampOf, type CalendarEventView } from "@/lib/calendar/ir-shared";
import { t } from "@/lib/i18n/server";
import { dateRange, type Row } from "@/plugins/workspace/model";
import type { WorkspaceSource } from "@/plugins/workspace/source-point";
import { makePersonResolver } from "@/plugins/people/resolve";
import { isInstalled } from "@/plugins/state";

/**
 * Your appointments as a source of the Workspace's pipelines - one record per appointment (a series' occurrences each) from Zeff's
 * calendar model (its own calendars, Google's, Outlook's), from a month back to three months ahead. The calendar engine stays in
 * Zeff (free times, meeting suggestions, booking, todos read the same tables); the database is a two-way view of it:
 *  - an edit of a row (title, start, end, all day, place, attendees, shown as) in an appointment of Zeff's own calendars is written
 *    to it at once - by hand, by an automation, by an agent over the MCP, by the assistant; an appointment that changed in the
 *    calendar since the row was read wins (the row follows);
 *  - a row of its own (with a title) is a new appointment in Zeff's calendar; deleting a row deletes its appointment;
 *  - Google's and Outlook's appointments are read-only here (they are changed in their source).
 * The calendar app is the database's first view: the whole calendar editing, on the same appointments.
 */

const REF = /^event:(\d+)(?:@(\d{4}-\d{2}-\d{2}))?$/;
const SRC = "srcref";
const EDITED = "srcedited";
const F = { start: "calstart", end: "calend", allDay: "calallday", calendar: "calcalendar", source: "calsource", location: "calplace", organizer: "calorganizer", attendees: "calattendees", online: "calonline", showAs: "calshow", response: "calresponse", people: "calpeople" };
const DAYS_BACK = 31;
const DAYS_AHEAD = 92;

const shift = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return dayOf(d);
};

/** What a record says about the appointment, as one short stamp: the row remembers it, and a change in the calendar shows as another. */
export function eventStamp(e: Pick<CalendarEventView, "title" | "start" | "end" | "allDay" | "location" | "description" | "showAs" | "attendees" | "organizer" | "online" | "response" | "calendarId" | "cancelled">): string {
  return createHash("sha1").update(JSON.stringify([e.title, e.start, e.end, e.allDay, e.location, e.description, e.showAs, e.attendees, e.organizer, e.online, e.response, e.calendarId, e.cancelled])).digest("hex").slice(0, 12);
}

export function calendarRecords() {
  // The people it is with: its attendees and organizer as the People plugin knows them (people/resolve.ts).
  const who = isInstalled("people") ? makePersonResolver() : null;
  const people = (e: CalendarEventView) => {
    const ids = [...new Set([e.organizer, ...e.attendees].map((a) => who!.person(a)).filter((x): x is number => !!x))];
    return ids.length ? ids : null;
  };
  return eventsBetween(shift(-DAYS_BACK), shift(DAYS_AHEAD))
    .filter((e) => !e.cancelled)
    .map((e) => ({
      ref: `event:${e.id}${e.occurrence ? `@${e.occurrence}` : ""}`,
      title: e.title || t("(no title)"),
      fields: {} as Record<string, string>,
      text: [e.location ? `${t("Where")}: ${e.location}` : "", e.attendees.length ? `${t("With")}: ${e.attendees.join(", ")}` : "", e.description].filter(Boolean).join("\n\n"),
      url: e.url || undefined,
      updatedAt: eventStamp(e),
      dataType: "calendar" as const,
      typed: [
        { id: F.start, name: "Start", type: "date" as const, value: e.start },
        { id: F.end, name: "End", type: "date" as const, value: e.end },
        { id: F.allDay, name: "All day", type: "checkbox" as const, value: e.allDay || null },
        { id: F.calendar, name: "Calendar", type: "text" as const, value: e.calendar.name },
        { id: F.source, name: "Source", type: "text" as const, value: SOURCE_LABELS[e.calendar.source] },
        { id: F.location, name: "Location", type: "text" as const, value: e.location },
        { id: F.organizer, name: "Organizer", type: "text" as const, value: e.organizer },
        { id: F.attendees, name: "Attendees", type: "text" as const, value: e.attendees.join(", ") },
        { id: F.online, name: "Online", type: "checkbox" as const, value: e.online || null },
        { id: F.showAs, name: "Shown as", type: "text" as const, value: e.showAs },
        { id: F.response, name: "Response", type: "text" as const, value: e.response ?? "" },
        ...(who ? [{ id: F.people, name: "People", type: "person" as const, value: people(e) }] : []),
      ],
    }));
}

// --- writing back ---

const text = (v: unknown) => String(v ?? "").trim();
const startOf = (v: unknown) => dateRange(v)?.start ?? "";
const endOf = (v: unknown) => dateRange(v)?.end ?? (typeof v === "string" ? v : "");
const list = (v: unknown) => [...new Set(text(v).split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean))];
const plusMinutes = (stamp: string, minutes: number) => {
  const d = new Date(`${stamp.slice(0, 16)}:00`);
  d.setMinutes(d.getMinutes() + minutes);
  return stampOf(d);
};
const nextDay = (day: string) => {
  const d = new Date(`${day.slice(0, 10)}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return dayOf(d);
};
const hourFromNow = () => {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return stampOf(d);
};

/** A start and end as the model has them: all-day ones as days (the end the day after), timed ones as local times (an end after the start). */
function timing(startRaw: string, endRaw: string, allDay: boolean): { start: string; end: string } {
  if (allDay) {
    const start = (startRaw || dayOf(new Date())).slice(0, 10);
    const end = endRaw.slice(0, 10);
    return { start, end: end > start ? end : nextDay(start) };
  }
  const start = !startRaw ? hourFromNow() : startRaw.length <= 10 ? `${startRaw}T09:00` : startRaw.slice(0, 16);
  const end = endRaw.length <= 10 && endRaw ? `${endRaw}T10:00` : endRaw.slice(0, 16);
  return { start, end: end > start ? end : plusMinutes(start, 60) };
}

/** What was edited in the database goes to the appointments of Zeff's own calendars; a row without an appointment makes one. */
export async function pullCalendar(_dbId: number, rows: Row[]): Promise<void> {
  const { setCell } = await import("@/plugins/workspace/store");
  for (const row of rows) {
    const ref = text(row.cells[SRC]);
    const m = REF.exec(ref);
    if (!m) {
      // A row of its own: a new appointment in Zeff's calendar (it needs a title; the row becomes its record at once).
      if (ref || !row.title.trim()) continue;
      const allDay = row.cells[F.allDay] === true;
      const { start, end } = timing(startOf(row.cells[F.start]), endOf(row.cells[F.end]), allDay);
      const made = addEvent(zeffCalendar(text(row.cells[F.calendar])).id, {
        title: row.title.trim(),
        start,
        end,
        allDay,
        location: text(row.cells[F.location]),
        attendees: list(row.cells[F.attendees]),
        ...(text(row.cells[F.showAs]) ? { showAs: text(row.cells[F.showAs]) } : {}),
      });
      setCell(row.id, SRC, `event:${made.id}`);
      setCell(row.id, EDITED, eventStamp(made));
      continue;
    }
    const cur = eventById(Number(m[1]), m[2]);
    // Google's and Outlook's are read-only here; one that changed in the calendar since the row was read wins (the row follows).
    if (!cur || cur.calendar.source !== "zeff" || text(row.cells[EDITED]) !== eventStamp(cur)) continue;
    const allDay = row.cells[F.allDay] === true;
    const when = timing(startOf(row.cells[F.start]) || cur.start, endOf(row.cells[F.end]) || cur.end, allDay);
    const patch: Parameters<typeof updateEvent>[1] = {};
    if (row.title.trim() && row.title.trim() !== cur.title) patch.title = row.title.trim();
    if (allDay !== cur.allDay) patch.allDay = allDay;
    if (when.start !== cur.start) patch.start = when.start;
    if (when.end !== cur.end) patch.end = when.end;
    if (text(row.cells[F.location]) !== cur.location) patch.location = text(row.cells[F.location]);
    const attendees = list(row.cells[F.attendees]);
    if (attendees.join("|") !== cur.attendees.join("|")) patch.attendees = attendees;
    const show = text(row.cells[F.showAs]);
    if (show && show !== cur.showAs) patch.showAs = show;
    if (!Object.keys(patch).length) continue;
    if (m[2]) updateOccurrence(cur.id, m[2], patch, "one");
    else updateEvent(cur.id, patch);
  }
}

/** A row deleted: the appointment goes (a series' occurrence: this one). Appointments of Google and Outlook can't be deleted here. */
export function removeAppointment(_dbId: number, ref: string): void {
  const m = REF.exec(ref);
  if (!m) return;
  const cur = eventById(Number(m[1]), m[2]);
  if (!cur) return;
  if (cur.calendar.source !== "zeff") throw new Error(t("This appointment is in {source} — delete it there; only appointments in Zeff's own calendars can be deleted here.", { source: SOURCE_LABELS[cur.calendar.source] }));
  if (m[2]) deleteOccurrence(cur.id, m[2], "one");
  else deleteEvent(cur.id);
}

export const CALENDAR_SOURCE: WorkspaceSource = {
  id: "calendar",
  get label() {
    return t("Calendar");
  },
  icon: "📅",
  dataType: "calendar",
  get hint() {
    return t("Your appointments (Zeff's calendars, Google, Outlook) from a month back to three months ahead — Zeff's own can be changed here.");
  },
  count: () => eventsBetween(shift(-DAYS_BACK), shift(DAYS_AHEAD)).filter((e) => !e.cancelled).length,
  read: calendarRecords,
  pull: pullCalendar,
  remove: removeAppointment,
};
