import { addDays } from "./stats";

/** Days for the series: a moment's local day, today, and counts filled with 0 over the days a source covers. */

/** The local day ("YYYY-MM-DD") of a stored moment — an ISO time, or SQLite's "YYYY-MM-DD HH:MM:SS" (UTC). */
export function localDay(stamp: string): string | null {
  const d = localDate(stamp);
  return d ? d.toLocaleDateString("sv-SE") : null;
}

/** A stored moment as a Date (SQLite's CURRENT_TIMESTAMP is UTC without a zone). */
export function localDate(stamp: string | null | undefined): Date | null {
  if (!stamp) return null;
  const s = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(stamp) ? `${stamp.replace(" ", "T")}Z` : stamp;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const todayLocal = (): string => new Date().toLocaleDateString("sv-SE");

/**
 * Values per day over what a source covers: from its first record (`first`, or the period's start if later) to the period's end
 * (or `last`, or today — whichever is first); a day in between without a value is a 0. Nothing covered: an empty map.
 */
export function filled(values: Map<string, number>, range: { from: string; to: string }, first: string | null, last?: string | null): Map<string, number> {
  const out = new Map<string, number>();
  if (!first) return out;
  const start = first > range.from ? first : range.from;
  let end = range.to < todayLocal() ? range.to : todayLocal();
  if (last && last < end) end = last;
  for (let day = start; day <= end; day = addDays(day, 1)) out.set(day, Math.round((values.get(day) ?? 0) * 1000) / 1000);
  return out;
}
