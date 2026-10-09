import { addDays, addMonths, format, getDaysInMonth, parseISO, startOfMonth } from "date-fns";
import { isoDate, isValidIsoDate, shiftWeek, weekFromDate, type WeekInfo } from "./week";

/** A calendar month. */
export type MonthInfo = {
  year: number;
  /** 1 = January … 12 = December. */
  month: number;
  /** e.g. "2026-09" — also the format used by <input type="month">. */
  key: string;
  /** The 1st, 00:00. */
  start: Date;
  /** The last day, 00:00. */
  end: Date;
  /** Every day of the month, in order. */
  days: Date[];
  /** YYYY-MM-DD */
  startIso: string;
  /** YYYY-MM-DD */
  endIso: string;
  /** The ISO weeks (Monday–Sunday) overlapping the month, in order. */
  weeks: WeekInfo[];
};

const MONTH_KEY_RE = /^(\d{4})-(\d{1,2})$/;

export function monthFromDate(d: Date): MonthInfo {
  const start = startOfMonth(d);
  const days = Array.from({ length: getDaysInMonth(start) }, (_, i) => addDays(start, i));
  const end = days[days.length - 1];
  const endIso = isoDate(end);
  const weeks: WeekInfo[] = [];
  for (let w = weekFromDate(start); w.startIso <= endIso; w = shiftWeek(w, 1)) weeks.push(w);
  return {
    year: start.getFullYear(),
    month: start.getMonth() + 1,
    key: format(start, "yyyy-MM"),
    start,
    end,
    days,
    startIso: isoDate(start),
    endIso,
    weeks,
  };
}

/**
 * Resolve a month from user input: a month key ("2026-09"), an ISO date (any day inside
 * the month) or nothing (the current month). Returns null when the input is unparseable.
 */
export function resolveMonth(input?: string | null): MonthInfo | null {
  if (!input || !input.trim()) return currentMonth();
  const s = input.trim();
  const m = MONTH_KEY_RE.exec(s);
  if (m) {
    const month = Number(m[2]);
    if (month < 1 || month > 12) return null;
    return monthFromDate(new Date(Number(m[1]), month - 1, 1));
  }
  if (isValidIsoDate(s)) return monthFromDate(parseISO(s));
  return null;
}

export function currentMonth(): MonthInfo {
  return monthFromDate(new Date());
}

export function shiftMonth(m: MonthInfo, delta: number): MonthInfo {
  return monthFromDate(addMonths(m.start, delta));
}

/** The last full month and the current one (the Roar approvals card's window). */
export function lastAndCurrentMonth(): { last: MonthInfo; current: MonthInfo } {
  const current = currentMonth();
  return { last: shiftMonth(current, -1), current };
}

/** "September 2026". */
export function formatMonth(m: MonthInfo): string {
  return format(m.start, "MMMM yyyy");
}

/** A week's days inside the month, e.g. "1–6 Sep" or "28–30 Sep". */
export function weekRangeInMonth(w: WeekInfo, m: MonthInfo): string {
  const from = w.startIso < m.startIso ? m.start : w.start;
  const to = w.endIso > m.endIso ? m.end : w.end;
  return from.getTime() === to.getTime() ? format(to, "d MMM") : `${format(from, "d")}–${format(to, "d MMM")}`;
}
