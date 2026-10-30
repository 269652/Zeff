/**
 * Local calendar days and stamps as text — what was written by hand in many places
 * (`${getFullYear()}-${pad(...)}`). Always the local time zone: `toISOString().slice(0, 10)` is the
 * UTC day, a day off between midnight and 1 or 2 a.m. here. No imports: client modules use it too.
 */

const two = (n: number): string => String(n).padStart(2, "0");

/** The local day of `d` (now by default) as YYYY-MM-DD. */
export const localDay = (d: Date = new Date()): string => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;

/** The local time of `d` (now by default) as YYYY-MM-DDTHH:MM (what <input type="datetime-local"> takes). */
export const localStamp = (d: Date = new Date()): string => `${localDay(d)}T${two(d.getHours())}:${two(d.getMinutes())}`;

/** The local month of `d` (now by default) as YYYY-MM. */
export const monthKey = (d: Date = new Date()): string => `${d.getFullYear()}-${two(d.getMonth() + 1)}`;

/** A YYYY-MM-DD day n days later (earlier for negative n), by the calendar (no DST hour drift). */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.slice(0, 10).split("-").map(Number);
  return localDay(new Date(y, m - 1, d + n));
}
