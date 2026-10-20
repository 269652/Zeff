/**
 * Recurring appointments ("Serientermine") of Zeff's own calendars: a rule (every day / week on
 * these weekdays / month on a day or on the nth weekday / year; every n; until a day or n times),
 * stored with the series' first appointment and expanded when read — never stored per occurrence.
 * Occurrences left out (moved, deleted one by one) are its exceptions (`exdates`). Client-safe.
 */

import { pad2 as two } from "@/lib/text";
import { currentLocale } from "@/lib/format";
import { type T, translator } from "@/lib/i18n/shared";

export type Frequency = "daily" | "weekly" | "monthly" | "yearly";

export type Recurrence = {
  freq: Frequency;
  /** Every n days / weeks / months / years. */
  interval: number;
  /** Weekly: the weekdays, 0 = Monday … 6 = Sunday (none: the first appointment's). */
  byDay?: number[];
  /** Monthly: on the same day of the month, or on the same weekday of the month (2nd Tuesday, last Friday). */
  monthlyBy?: "day" | "weekday";
  /** The last day an occurrence may start on ("YYYY-MM-DD", inclusive). */
  until?: string;
  /** At most this many occurrences (the first one counted). */
  count?: number;
};

/** A todo's rule: a series' rule and — when its first due day is a one-off (pay now, then every 15th) — the day the repeats begin. */
export type TodoRecurrence = Recurrence & { start?: string };

/** A todo's rule as stored (JSON) — cleaned; null when it isn't one. */
export function parseTodoRecurrence(raw: unknown): TodoRecurrence | null {
  const r = parseRecurrence(raw);
  if (!r) return null;
  let v: unknown = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return r;
    }
  }
  const start = (v as { start?: unknown } | null)?.start;
  return typeof start === "string" && /^\d{4}-\d{2}-\d{2}$/.test(start) ? { ...r, start } : r;
}

const SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const ymd = (d: Date) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
const stamp = (d: Date) => `${ymd(d)}T${two(d.getHours())}:${two(d.getMinutes())}`;
const local = (s: string) => new Date(s.length === 10 ? `${s}T00:00:00` : `${s.slice(0, 16)}:00`);
/** Monday = 0 … Sunday = 6. */
export const weekdayOf = (d: Date) => (d.getDay() + 6) % 7;
/** Which of its weekday in the month a day is: 0 = first … 3 = fourth, 4 = the last one. */
export function nthOf(d: Date): number {
  const nth = Math.floor((d.getDate() - 1) / 7);
  const next = new Date(d);
  next.setDate(d.getDate() + 7);
  return next.getMonth() !== d.getMonth() && nth >= 3 ? 4 : nth;
}

/** A rule as stored (JSON) — cleaned; null when it isn't one. */
export function parseRecurrence(raw: unknown): Recurrence | null {
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const freq = o.freq;
  if (freq !== "daily" && freq !== "weekly" && freq !== "monthly" && freq !== "yearly") return null;
  const r: Recurrence = { freq, interval: Math.max(1, Math.min(99, Math.round(Number(o.interval) || 1))) };
  if (freq === "weekly" && Array.isArray(o.byDay)) {
    const days = [...new Set(o.byDay.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort();
    if (days.length) r.byDay = days;
  }
  if (freq === "monthly" && o.monthlyBy === "weekday") r.monthlyBy = "weekday";
  if (typeof o.until === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.until)) r.until = o.until;
  else if (Number(o.count) > 0) r.count = Math.min(999, Math.round(Number(o.count)));
  return r;
}

/** The day the nth (0–3; 4 = last) weekday falls on in a month — null when that month hasn't it. */
function nthWeekday(year: number, month: number, weekday: number, nth: number): Date | null {
  if (nth === 4) {
    const last = new Date(year, month + 1, 0);
    last.setDate(last.getDate() - ((weekdayOf(last) - weekday + 7) % 7));
    return last;
  }
  const first = new Date(year, month, 1);
  const d = new Date(year, month, 1 + ((weekday - weekdayOf(first) + 7) % 7) + nth * 7);
  return d.getMonth() === month ? d : null;
}

/**
 * The days a series' occurrences start on (its first one's time kept), from its first one on, in
 * order — until `before` ("YYYY-MM-DD", exclusive), its end, or `limit` days.
 */
export function occurrenceDays(firstStart: string, r: Recurrence, before: string, limit = 50000): string[] {
  const first = local(firstStart.slice(0, 10));
  const end = r.until && r.until < before ? addDays(r.until, 1) : before;
  const out: string[] = [];
  const push = (d: Date) => {
    const s = ymd(d);
    if (s < firstStart.slice(0, 10) || s >= end) return false;
    out.push(s);
    return !(r.count && out.length >= r.count);
  };
  let guard = 0;
  if (r.freq === "daily") {
    for (let d = new Date(first); ymd(d) < end && guard++ < limit; d.setDate(d.getDate() + r.interval)) if (!push(d)) break;
  } else if (r.freq === "weekly") {
    const days = r.byDay?.length ? r.byDay : [weekdayOf(first)];
    const monday = new Date(first);
    monday.setDate(first.getDate() - weekdayOf(first));
    outer: for (let w = new Date(monday); ymd(w) < end && guard++ < limit; w.setDate(w.getDate() + 7 * r.interval))
      for (const wd of days) {
        const d = new Date(w);
        d.setDate(w.getDate() + wd);
        if (ymd(d) < firstStart.slice(0, 10)) continue;
        if (ymd(d) >= end) break outer;
        if (!push(d)) break outer;
      }
  } else if (r.freq === "monthly") {
    const day = first.getDate();
    const wd = weekdayOf(first);
    const nth = nthOf(first);
    for (let m = 0; guard++ < limit; m += r.interval) {
      const y = first.getFullYear() + Math.floor((first.getMonth() + m) / 12);
      const mo = (first.getMonth() + m) % 12;
      if (ymd(new Date(y, mo, 1)) >= end) break;
      const d = r.monthlyBy === "weekday" ? nthWeekday(y, mo, wd, nth) : new Date(y, mo, day);
      // A month without that day (the 31st, the 5th Monday): none that month.
      if (!d || (r.monthlyBy !== "weekday" && d.getMonth() !== mo)) continue;
      if (!push(d)) break;
    }
  } else {
    for (let n = 0; guard++ < limit; n += r.interval) {
      const d = new Date(first.getFullYear() + n, first.getMonth(), first.getDate());
      if (ymd(d) >= end) break;
      // The 29th of February in a year without it: none that year.
      if (d.getMonth() !== first.getMonth()) continue;
      if (!push(d)) break;
    }
  }
  return out;
}

/** A local day plus days. */
export function addDays(day: string, n: number): string {
  const d = local(day);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

/** A local stamp moved to another day, its time kept ("2026-10-12T09:30" → "2026-10-19T09:30"). */
export const onDay = (s: string, day: string) => (s.length === 10 ? day : `${day}${s.slice(10)}`);

/**
 * The occurrences of a series that overlap [from, to) — each its start and end (the first one's
 * duration, in local time across daylight saving), the day it falls on, those left out skipped.
 */
export function expand(series: { start: string; end: string; allDay: boolean }, r: Recurrence, exdates: string[], from: string, to: string): { start: string; end: string; occurrence: string }[] {
  const s = local(series.start);
  const e = local(series.end);
  const days = series.allDay ? Math.round((e.getTime() - s.getTime()) / 864e5) : 0;
  const minutes = series.allDay ? 0 : Math.round((e.getTime() - s.getTime()) / 60000);
  // An occurrence may start before `from` and still reach into it.
  const lookback = series.allDay ? days : Math.ceil(minutes / 1440);
  const out: { start: string; end: string; occurrence: string }[] = [];
  const skip = new Set(exdates);
  for (const day of occurrenceDays(series.start, r, addDays(to.slice(0, 10), 1))) {
    if (day < addDays(from.slice(0, 10), -lookback - 1) || skip.has(day)) continue;
    const start = onDay(series.start, day);
    let end: string;
    if (series.allDay) end = addDays(day, days);
    else {
      const d = local(start);
      d.setMinutes(d.getMinutes() + minutes);
      end = stamp(d);
    }
    if (start < to && end > from) out.push({ start, end, occurrence: day });
  }
  return out;
}

/** The weekdays' and ordinals' words in the language of `t`. */
const weekdayNames = (t: T) => [t("Monday"), t("Tuesday"), t("Wednesday"), t("Thursday"), t("Friday"), t("Saturday"), t("Sunday")];
const ordinals = (t: T) => [t("first"), t("second"), t("third"), t("fourth"), t("last")];

/** "12 October" in the locale dates are shown in. */
const dayMonth = (d: Date) => d.toLocaleDateString(currentLocale(), { day: "numeric", month: "long" });

/**
 * The rule in words: "Every week on Monday and Wednesday, 10 times", "Monthly on the last Friday" —
 * in the language of `t` (English without).
 */
export function describeRecurrence(r: Recurrence, firstStart: string, t: T = translator("en")): string {
  const first = local(firstStart.slice(0, 10));
  const one = r.interval === 1;
  const n = r.interval;
  const names = weekdayNames(t);
  let text: string;
  if (r.freq === "daily") text = one ? t("Daily") : t("Every {n} days", { n });
  else if (r.freq === "weekly") {
    const nums = r.byDay?.length ? r.byDay : [weekdayOf(first)];
    const days = nums.map((d) => names[d]);
    const which =
      nums.length === 5 && nums.every((d, i) => d === i)
        ? t("weekdays")
        : days.length === 7
          ? t("every day")
          : days.length === 1
            ? days[0]
            : t("{list} and {last}", { list: days.slice(0, -1).join(", "), last: days[days.length - 1] });
    text = one ? t("Weekly on {days}", { days: which }) : t("Every {n} weeks on {days}", { n, days: which });
  } else if (r.freq === "monthly") {
    if (r.monthlyBy === "weekday") {
      const on = { nth: ordinals(t)[nthOf(first)], weekday: names[weekdayOf(first)] };
      text = one ? t("Monthly on the {nth} {weekday}", on) : t("Every {n} months on the {nth} {weekday}", { n, ...on });
    } else text = one ? t("Monthly on day {day}", { day: first.getDate() }) : t("Every {n} months on day {day}", { n, day: first.getDate() });
  } else text = one ? t("Yearly on {date}", { date: dayMonth(first) }) : t("Every {n} years on {date}", { n, date: dayMonth(first) });
  if (r.until) {
    const date = local(r.until).toLocaleDateString(currentLocale(), { day: "numeric", month: "short", year: "numeric" });
    text += `, ${t("until {date}", { date })}`;
  } else if (r.count) text += `, ${r.count === 1 ? t("1 time") : t("{n} times", { n: r.count })}`;
  return text;
}

/** The repeat presets the editor offers for a first start — and the rule each stands for (labels in the language of `t`). */
export function presets(firstStart: string, t: T = translator("en")): { key: string; label: string; rule: Recurrence | null }[] {
  const first = local(firstStart.slice(0, 10));
  const wd = weekdayOf(first);
  const day = weekdayNames(t)[wd];
  return [
    { key: "none", label: t("Does not repeat"), rule: null },
    { key: "daily", label: t("Daily"), rule: { freq: "daily", interval: 1 } },
    { key: "weekdays", label: t("Every weekday (Mon–Fri)"), rule: { freq: "weekly", interval: 1, byDay: [0, 1, 2, 3, 4] } },
    { key: "weekly", label: t("Weekly on {days}", { days: day }), rule: { freq: "weekly", interval: 1, byDay: [wd] } },
    { key: "biweekly", label: t("Every {n} weeks on {days}", { n: 2, days: day }), rule: { freq: "weekly", interval: 2, byDay: [wd] } },
    { key: "monthly", label: t("Monthly on day {day}", { day: first.getDate() }), rule: { freq: "monthly", interval: 1, monthlyBy: "day" } },
    {
      key: "monthly-weekday",
      label: t("Monthly on the {nth} {weekday}", { nth: ordinals(t)[nthOf(first)], weekday: day }),
      rule: { freq: "monthly", interval: 1, monthlyBy: "weekday" },
    },
    { key: "yearly", label: t("Yearly on {date}", { date: dayMonth(first) }), rule: { freq: "yearly", interval: 1 } },
  ];
}

/** A monthly rule's two kinds for a first start: "On day 12", "On the second Monday" (in the language of `t`). */
export function monthlyChoices(firstStart: string, t: T = translator("en")): { by: "day" | "weekday"; label: string }[] {
  const first = local(firstStart.slice(0, 10));
  return [
    { by: "day", label: t("On day {day}", { day: first.getDate() }) },
    { by: "weekday", label: t("On the {nth} {weekday}", { nth: ordinals(t)[nthOf(first)], weekday: weekdayNames(t)[weekdayOf(first)] }) },
  ];
}

/** The weekdays, short (Mon … Sun), in English — weekdayShort(t) in the language of `t`. */
export const WEEKDAY_SHORT = SHORT;
export const weekdayShort = (t: T) => [t("Mon"), t("Tue"), t("Wed"), t("Thu"), t("Fri"), t("Sat"), t("Sun")];
