/**
 * The Kalender app's views — what they share: the views and their ranges, the items they show (an
 * appointment of a calendar, a todo's proposed one), side-by-side lanes for overlaps, dates and
 * times as they're written, snapping. Client-safe.
 */
import type { CalendarEventView, CalendarView, ProposedEvent } from "@/lib/calendar/ir-shared";
import { addDays, weekdayOf } from "@/lib/calendar/recurrence";

export const VIEWS = ["day", "week", "month", "agenda"] as const;
export type ViewKind = (typeof VIEWS)[number];
export const isView = (v: unknown): v is ViewKind => (VIEWS as readonly unknown[]).includes(v);
export const VIEW_LABELS: Record<ViewKind, string> = { day: "Day", week: "Week", month: "Month", agenda: "Agenda" };

/** An appointment as a view shows it: a calendar's (one occurrence of a series is one item), or one a todo proposes. */
export type Item = {
  /** Unique in the view: "e<id>" (an occurrence: "e<id>@<day>"), "p<n>". */
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  color: string;
  /** Changeable here: Zeff's own calendars (Google's and Outlook's open in their source). */
  editable: boolean;
  event?: CalendarEventView;
  calendar?: CalendarView;
  proposed?: ProposedEvent;
};

const two = (n: number) => String(n).padStart(2, "0");
export const local = (s: string) => new Date(s.length === 10 ? `${s}T00:00:00` : `${s.slice(0, 16)}:00`);
export const ymd = (d: Date) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
export const stampAt = (day: string, minutes: number) => `${day}T${two(Math.floor(minutes / 60))}:${two(minutes % 60)}`;
export const minutesOf = (s: string) => (s.length === 10 ? 0 : Number(s.slice(11, 13)) * 60 + Number(s.slice(14, 16)));
/** Minutes from one stamp to another (across days and daylight saving, in local time). */
export const minutesBetween = (a: string, b: string) => Math.round((local(b).getTime() - local(a).getTime()) / 60000);
export const plus = (s: string, minutes: number) => {
  const d = local(s);
  d.setMinutes(d.getMinutes() + minutes);
  return `${ymd(d)}T${two(d.getHours())}:${two(d.getMinutes())}`;
};
export const snap = (minutes: number, step = 15) => Math.round(minutes / step) * step;

/** The Monday of a day's week. */
export const mondayOf = (day: string) => addDays(day, -weekdayOf(local(day)));
/** ISO week number. */
export function isoWeek(day: string): number {
  const d = local(day);
  d.setDate(d.getDate() + 3 - weekdayOf(d));
  const jan4 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d.getTime() - jan4.getTime()) / 864e5 - 3 + weekdayOf(jan4)) / 7);
}

/** The days a view shows around a day, and the range its appointments are read for ([from, to), days). */
export function viewRange(view: ViewKind, day: string): { days: string[]; from: string; to: string } {
  if (view === "day") return { days: [day], from: day, to: addDays(day, 1) };
  if (view === "week") {
    const from = mondayOf(day);
    return { days: Array.from({ length: 7 }, (_, i) => addDays(from, i)), from, to: addDays(from, 7) };
  }
  if (view === "month") {
    const from = mondayOf(`${day.slice(0, 7)}-01`);
    return { days: Array.from({ length: 42 }, (_, i) => addDays(from, i)), from, to: addDays(from, 42) };
  }
  return { days: Array.from({ length: 30 }, (_, i) => addDays(day, i)), from: day, to: addDays(day, 30) };
}

/** The day a step back or forward goes to. */
export function stepDay(view: ViewKind, day: string, n: number): string {
  if (view === "day") return addDays(day, n);
  if (view === "week") return addDays(day, 7 * n);
  if (view === "agenda") return addDays(day, 30 * n);
  const d = local(`${day.slice(0, 7)}-01`);
  d.setMonth(d.getMonth() + n);
  return ymd(d);
}

/** The heading of what's shown: "12 – 18 Oct 2026", "October 2026", "Monday, 12 October 2026". */
export function viewTitle(view: ViewKind, day: string): string {
  const d = local(day);
  if (view === "day") return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  if (view === "month") return d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const { days } = viewRange(view, day);
  const a = local(days[0]);
  const b = local(days[days.length - 1]);
  const sameMonth = a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  return `${a.toLocaleDateString("en-GB", sameMonth ? { day: "numeric" } : { day: "numeric", month: "short", ...(a.getFullYear() !== b.getFullYear() ? { year: "numeric" } : {}) })} – ${b.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
}

export const timeText = (s: string) => (s.length === 10 ? "" : s.slice(11, 16));

/** "Mon 12 Oct, 09:00 – 10:30", "Mon 12 – Wed 14 Oct · all day". */
export function whenText(it: Pick<Item, "start" | "end" | "allDay">): string {
  const day = (s: string) => local(s).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  if (it.allDay) {
    const last = addDays(it.end, -1);
    return last > it.start ? `${day(it.start)} – ${day(last)} · all day` : `${day(it.start)} · all day`;
  }
  return it.start.slice(0, 10) === it.end.slice(0, 10) || (it.end.slice(11) === "00:00" && addDays(it.start.slice(0, 10), 1) === it.end.slice(0, 10))
    ? `${day(it.start)}, ${timeText(it.start)} – ${timeText(it.end)}`
    : `${day(it.start)} ${timeText(it.start)} – ${day(it.end)} ${timeText(it.end)}`;
}

/** "45 min", "1 h", "1 h 30 min". */
export const durationText = (minutes: number) => (minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ""}`);

/** A day's timed appointments side by side where they overlap: each its lane and how many lanes its group has. */
export function lanes<T extends { start: string; end: string }>(items: T[]): (T & { lane: number; of: number })[] {
  const sorted = [...items].sort((a, b) => a.start.localeCompare(b.start) || b.end.localeCompare(a.end));
  const out: (T & { lane: number; of: number })[] = [];
  let group: (T & { lane: number; of: number })[] = [];
  let groupEnd = "";
  const close = () => {
    const n = Math.max(1, ...group.map((g) => g.lane + 1));
    for (const g of group) g.of = n;
    out.push(...group);
    group = [];
  };
  for (const it of sorted) {
    if (group.length && it.start >= groupEnd) close();
    const ends: string[] = [];
    for (const g of group) ends[g.lane] = ends[g.lane] && ends[g.lane] > g.end ? ends[g.lane] : g.end;
    let lane = ends.findIndex((e) => !e || e <= it.start);
    if (lane < 0) lane = ends.length;
    group.push({ ...it, lane, of: 1 });
    groupEnd = groupEnd > it.end ? groupEnd : it.end;
  }
  if (group.length) close();
  return out;
}

/** An item's day range (all-day: its days; timed: the days it touches). */
export const itemOn = (it: Pick<Item, "start" | "end" | "allDay">, day: string) =>
  it.allDay ? it.start <= day && it.end > day : it.start.slice(0, 10) <= day && (it.end > `${day}T00:00` || it.start.slice(0, 10) === day);
