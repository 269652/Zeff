import { eventsBetween } from "@/lib/calendar/ir";
import { t } from "@/lib/i18n/server";
import type { Series, SeriesProvider, SeriesRange } from "@/plugins/correlations/series-point";

/**
 * Sleep as daily series (the Calendar plugin, for the Correlations): what a sleep tracker writes into a calendar of its own — Sleep
 * as Android's "Sleep" appointments, one per sleep — read per day you woke up on: how long you slept (naps too), when the main sleep
 * (the longest that ended that day) began and when it ended. A sleep of more than 16 hours is a tracking error, one under a quarter
 * of an hour noise: both left out. A night without one is a day without a value. Its series are personal (lib/boundaries: "sleep").
 * Server only.
 */

/** A calendar a sleep tracker writes into (by its name). */
export const isSleepCalendar = (name: string): boolean => /\bsleep\b|schlaf/i.test(name);

const hoursOf = (s: string) => Number(s.slice(11, 13)) + Number(s.slice(14, 16)) / 60;
const shift = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("sv-SE");
};

export type Sleep = { start: string; end: string };

/** The sleeps as series values per day woken on: hours slept in all, the main sleep's bedtime (after midnight: 24 +) and its waking. */
export function sleepSeriesValues(sleeps: Sleep[], range: SeriesRange): { hours: Map<string, number>; bedtime: Map<string, number>; wake: Map<string, number> } {
  const hours = new Map<string, number>();
  const main = new Map<string, Sleep & { h: number }>();
  for (const s of sleeps) {
    const day = s.end.slice(0, 10);
    if (day < range.from || day > range.to) continue;
    const h = (new Date(s.end).getTime() - new Date(s.start).getTime()) / 36e5;
    if (!(h >= 0.25 && h <= 16)) continue;
    hours.set(day, (hours.get(day) ?? 0) + h);
    if (!main.has(day) || main.get(day)!.h < h) main.set(day, { ...s, h });
  }
  const bedtime = new Map<string, number>();
  const wake = new Map<string, number>();
  for (const [day, s] of main) {
    // An evening's bedtime as it is (22.5), one after midnight past 24 (00:44 → 24.7): later is more, across midnight.
    const b = hoursOf(s.start);
    bedtime.set(day, s.start.slice(0, 10) === day ? b + 24 : b);
    wake.set(day, hoursOf(s.end));
  }
  const round = (m: Map<string, number>) => new Map([...m].map(([k, v]) => [k, Math.round(v * 100) / 100]));
  return { hours: round(hours), bedtime: round(bedtime), wake: round(wake) };
}

function sleepSeries(range: SeriesRange): Series[] {
  // (A sleep ends on its day: it may have begun the evening before.)
  const sleeps = eventsBetween(`${shift(range.from, -1)}T00:00`, `${shift(range.to, 1)}T00:00`)
    .filter((e) => !e.allDay && !e.cancelled && isSleepCalendar(e.calendar.name))
    .map((e) => ({ start: e.start, end: e.end }));
  if (!sleeps.length) return [];
  const v = sleepSeriesValues(sleeps, range);
  const group = t("Sleep");
  return [
    { id: "sleep:hours", label: t("Hours slept"), group, kind: "number", unit: "h", values: v.hours },
    { id: "sleep:bedtime", label: t("Bedtime"), group, kind: "number", unit: "h", values: v.bedtime },
    { id: "sleep:wake", label: t("Woke up"), group, kind: "number", unit: "h", values: v.wake },
  ];
}

export const SLEEP_SERIES: SeriesProvider = {
  id: "calendar.sleep",
  series: sleepSeries,
};
