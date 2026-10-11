import {
  addDays,
  addWeeks,
  format,
  getISOWeek,
  getISOWeekYear,
  isValid,
  parseISO,
  startOfISOWeek,
} from "date-fns";

/** A calendar week (ISO 8601: Monday–Sunday). */
export type WeekInfo = {
  year: number;
  week: number;
  /** e.g. "2026-W39" — also the format used by <input type="week">. */
  key: string;
  start: Date;
  end: Date;
  days: Date[];
  /** YYYY-MM-DD */
  startIso: string;
  /** YYYY-MM-DD */
  endIso: string;
};

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const WEEK_KEY_RE = /^(\d{4})-W(\d{1,2})$/i;

export function isoDate(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

export function todayIso(): string {
  return isoDate(new Date());
}

export function isValidIsoDate(s: string): boolean {
  if (!ISO_DATE_RE.test(s)) return false;
  const d = parseISO(s);
  return isValid(d) && isoDate(d) === s;
}

export function weekFromDate(d: Date): WeekInfo {
  const start = startOfISOWeek(d);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const year = getISOWeekYear(start);
  const week = getISOWeek(start);
  return {
    year,
    week,
    key: `${year}-W${String(week).padStart(2, "0")}`,
    start,
    end: days[6],
    days,
    startIso: isoDate(start),
    endIso: isoDate(days[6]),
  };
}

export function weekFromKey(year: number, week: number): WeekInfo {
  // ISO week 1 is the week containing January 4th.
  const jan4 = new Date(year, 0, 4);
  return weekFromDate(addWeeks(startOfISOWeek(jan4), week - 1));
}

/**
 * Resolve a week from user input: an ISO week key ("2026-W39"), an ISO date
 * ("2026-09-21", any day inside the week) or nothing (current week).
 * Returns null when the input is present but unparseable.
 */
export function resolveWeek(input?: string | null): WeekInfo | null {
  if (!input || !input.trim()) return weekFromDate(new Date());
  const s = input.trim();
  const m = WEEK_KEY_RE.exec(s);
  if (m) {
    const year = Number(m[1]);
    const week = Number(m[2]);
    if (week < 1 || week > 53) return null;
    return weekFromKey(year, week);
  }
  if (isValidIsoDate(s)) return weekFromDate(parseISO(s));
  return null;
}

export function currentWeek(): WeekInfo {
  return weekFromDate(new Date());
}

export function shiftWeek(w: WeekInfo, delta: number): WeekInfo {
  return weekFromDate(addWeeks(w.start, delta));
}

export function formatWeekRange(w: WeekInfo): string {
  const sameMonth = w.start.getMonth() === w.end.getMonth();
  const startFmt = sameMonth ? "d" : "d MMM";
  return `${format(w.start, startFmt)} – ${format(w.end, "d MMM yyyy")}`;
}

export function formatDay(d: Date, fmt = "EEE d"): string {
  return format(d, fmt);
}
