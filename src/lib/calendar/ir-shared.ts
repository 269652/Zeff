/**
 * Zeff's calendar model (the "IR" every calendar is read into — Zeff's own, Google Calendar,
 * Outlook): what the Kalender app, free times and booking see. Client-safe.
 */

import { pad2 as two } from "@/lib/text";
import type { Recurrence } from "./recurrence";
import { localDay } from "@/lib/dates";

export type CalendarSourceKind = "zeff" | "google" | "outlook";

export const SOURCE_LABELS: Record<CalendarSourceKind, string> = { zeff: "Zeff", google: "Google Calendar", outlook: "Outlook" };

export type CalendarView = {
  id: number;
  key: string;
  source: CalendarSourceKind;
  name: string;
  color: string;
  visible: boolean;
  /** Its appointments block time (free times, appointment proposals). */
  busy: boolean;
  /** Its meetings are offered for booking (Zeiterfassung). */
  book: boolean;
  /** Its appointments become todos on their day (today's and tomorrow's). */
  todos: boolean;
  /** A Google calendar Zeff may write to (you own it or may write; Google holds Calendar's write access) — set by the calendar app's data. */
  writable?: boolean;
  /** A shadow calendar (one of Zeff's own, embedded in a page): its appointments are suggestions in the main calendar — accepted into a real one, or dismissed. */
  shadow?: boolean;
};

export type CalendarEventView = {
  id: number;
  calendarId: number;
  key: string;
  title: string;
  /** Local "YYYY-MM-DDTHH:MM" — all day: "YYYY-MM-DD" (end: the day after). */
  start: string;
  end: string;
  allDay: boolean;
  location: string;
  description: string;
  showAs: string;
  cancelled: boolean;
  response: string | null;
  private: boolean;
  online: boolean;
  organizer: string;
  attendees: string[];
  url: string;
  todoId: number | null;
  /** A series (Zeff's own calendars): its rule — this is one of its occurrences. */
  recurrence: Recurrence | null;
  /** An occurrence of a series: the day it falls on (null: not one). */
  occurrence: string | null;
  /** An occurrence changed on its own: its series. */
  seriesId: number | null;
};

/** Which occurrences a change to a series means. */
export type SeriesScope = "one" | "following" | "all";

/** An appointment a todo proposes (its action, not in a calendar yet). */
export type ProposedEvent = {
  todoId: number;
  todoRef: string;
  todoText: string;
  /** Which of the todo's actions it is (its place among them), and its type. */
  index: number;
  type: string;
  title: string;
  start: string;
  end: string;
  target: string;
  /** Where it opens filled in (Google Calendar, Outlook) — null: Zeff enters it itself. */
  href: string | null;
};

export const CALENDAR_COLORS = ["#4B99D2", "#C05476", "#55B080", "#DD7835", "#8E63CE", "#E4B429", "#3BA3A3", "#7A869A", "#0F6CBD"];

/** A local date as "YYYY-MM-DD". */
export const dayOf = localDay;
/** A local time as "YYYY-MM-DDTHH:MM". */
export const stampOf = (d: Date) => `${dayOf(d)}T${two(d.getHours())}:${two(d.getMinutes())}`;
/** "YYYY-MM-DD[THH:MM]" as a local Date. */
export const dateOf = (s: string) => new Date(s.length === 10 ? `${s}T00:00:00` : `${s.slice(0, 16)}:00`);
/** A start plus minutes, as a local stamp. */
export const plusMinutes = (start: string, minutes: number) => stampOf(new Date(dateOf(start).getTime() + minutes * 60000));
