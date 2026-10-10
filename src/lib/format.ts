/**
 * How Zeff shows numbers, dates and times — one place, one style (client-safe). The UI is English
 * with British conventions: day before month, 24-hour clock, a decimal point ("1.5 h", "Mon 12 Oct",
 * "14:05").
 */

export const LOCALE = "en-GB";

/** Format hours as a compact decimal, e.g. 1.5, 2, 0.25. */
export function formatHours(hours: number): string {
  if (!Number.isFinite(hours)) return "0";
  return (Math.round(hours * 100) / 100)
    .toFixed(2)
    .replace(/\.?0+$/, "");
}

/** Round to 2 decimals so 0.1 + 0.2 style sums stay tidy. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** To the nearest quarter hour (a meeting's length). */
export const roundQuarter = (h: number) => Math.round(h * 4) / 4;

/** Up to the next quarter hour, at least one (time worked: never less than started). */
export const ceilQuarter = (h: number) => Math.max(0.25, Math.ceil(h * 4 - 1e-9) / 4);

const toDate = (d: Date | string | number) => (d instanceof Date ? d : new Date(typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T00:00:00` : d));

/** "Mon 12 Oct" — with `year`: "Mon 12 Oct 2026"; `weekday: false`: "12 Oct". A YYYY-MM-DD is a local day. */
export function formatDate(d: Date | string | number, opts: { year?: boolean; weekday?: boolean } = {}): string {
  return toDate(d).toLocaleDateString(LOCALE, { ...(opts.weekday === false ? {} : { weekday: "short" }), day: "numeric", month: "short", ...(opts.year ? { year: "numeric" } : {}) });
}

/** "14:05". */
export function formatTime(d: Date | string | number): string {
  return toDate(d).toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" });
}

/** "12 Oct, 14:05" (with the year when it isn't this one). */
export function formatDateTime(d: Date | string | number, now = Date.now()): string {
  const date = toDate(d);
  const year = date.getFullYear() !== new Date(now).getFullYear();
  return `${formatDate(date, { weekday: false, year })}, ${formatTime(date)}`;
}

/** A span of time in words: "45 min", "3 h", "2 days". */
export function formatDuration(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 60) return `${Math.max(1, min)} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  const days = Math.floor(h / 24);
  return days === 1 ? "1 day" : `${days} days`;
}

/** How long ago: "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago" — after two months the date. */
export function formatAgo(d: Date | string | number, now = Date.now()): string {
  const t = toDate(d).getTime();
  const ms = now - t;
  if (!Number.isFinite(ms)) return "";
  if (ms < 60000) return "just now";
  if (ms < 24 * 3600e3) return `${formatDuration(ms)} ago`;
  const days = Math.floor(ms / (24 * 3600e3));
  if (days === 1) return "yesterday";
  if (days < 60) return `${days} days ago`;
  return formatDate(t, { weekday: false, year: true });
}
