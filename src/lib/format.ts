/**
 * How Zeff shows numbers, dates and times — one place, one style (client-safe), in the language
 * chosen (Settings): its locale for dates and numbers, its bundle for the words ("5 min ago").
 * English by default, British conventions: day before month, 24-hour clock ("Mon 12 Oct", "14:05").
 * The server sets the language for a render (applyLanguage), the browser's I18nProvider for its own.
 */

type Tr = (text: string, vars?: Record<string, string | number>) => string;
let locale = "en-GB";
let t: Tr = (text, vars) => (vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text);

/** The language to format in from now on (the browser's I18nProvider): its locale and its translator. */
export function setFormatLanguage(l: string, translate: Tr): void {
  locale = l;
  t = translate;
}

/**
 * On the server: where the language comes from — the account's, asked at each call (pages and the
 * layout render in no fixed order; a language set once could be the last request's).
 */
let resolve: (() => { locale: string; t: Tr }) | null = null;
export function setFormatResolver(fn: () => { locale: string; t: Tr }): void {
  resolve = fn;
}
const cur = () => (resolve ? resolve() : { locale, t });

/** The locale dates and numbers are shown in now ("en-GB", "de-DE" …). */
export const currentLocale = () => cur().locale;

/** Format hours as a compact decimal, e.g. 1.5, 2, 0.25. */
export function formatHours(hours: number): string {
  if (!Number.isFinite(hours)) return "0";
  return (Math.round(hours * 100) / 100).toLocaleString(currentLocale(), { maximumFractionDigits: 2, useGrouping: false });
}

/** Hours typed by a person: "1,5", "1.5" or "1:30" (h:mm). null when it is not a number. */
export function parseHours(text: string): number | null {
  const s = text.trim();
  if (!s) return null;
  const hm = /^(\d+):([0-5]\d)$/.exec(s);
  if (hm) return round2(Number(hm[1]) + Number(hm[2]) / 60);
  if (!/^\d*[.,]?\d+$|^\d+[.,]$/.test(s)) return null;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
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
  return toDate(d).toLocaleDateString(currentLocale(), { ...(opts.weekday === false ? {} : { weekday: "short" }), day: "numeric", month: "short", ...(opts.year ? { year: "numeric" } : {}) });
}

/** "14:05". */
export function formatTime(d: Date | string | number): string {
  return toDate(d).toLocaleTimeString(currentLocale(), { hour: "2-digit", minute: "2-digit" });
}

/** "12 Oct, 14:05" (with the year when it isn't this one). */
export function formatDateTime(d: Date | string | number, now = Date.now()): string {
  const date = toDate(d);
  const year = date.getFullYear() !== new Date(now).getFullYear();
  return `${formatDate(date, { weekday: false, year })}, ${formatTime(date)}`;
}

/** "Mon 12 Oct, 14:05" — the weekday too (with `year`: "Mon 12 Oct 2026, 14:05"). */
export function formatDayTime(d: Date | string | number, opts: { year?: boolean } = {}): string {
  return `${formatDate(d, opts)}, ${formatTime(d)}`;
}

/** In a list: the time when it is today, else the date ("14:05" / "Mon 12 Oct"). */
export function formatSmart(d: Date | string | number): string {
  const date = toDate(d);
  return new Date().toDateString() === date.toDateString() ? formatTime(date) : formatDate(date);
}

/** "Monday, 12 October" — a day heading. A YYYY-MM-DD is a local day. */
export function formatLongDay(d: Date | string | number): string {
  return toDate(d).toLocaleDateString(currentLocale(), { weekday: "long", day: "numeric", month: "long" });
}

/** The full date and time in the locale's own style (a tooltip). */
export function formatFull(d: Date | string | number): string {
  return toDate(d).toLocaleString(currentLocale());
}

/** An amount in US dollars ("$1.23"). */
export function formatUsd(n: number): string {
  return n.toLocaleString(currentLocale(), { style: "currency", currency: "USD" });
}

/** A span of time in words: "45 min", "3 h", "2 days". */
export function formatDuration(ms: number): string {
  const { t } = cur();
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 60) return t("{n} min", { n: Math.max(1, min) });
  const h = Math.floor(min / 60);
  if (h < 24) return t("{n} h", { n: h });
  const days = Math.floor(h / 24);
  return days === 1 ? t("1 day") : t("{n} days", { n: days });
}

/** How long ago: "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago" — after two months the date. */
export function formatAgo(d: Date | string | number, now = Date.now()): string {
  const { t } = cur();
  const at = toDate(d).getTime();
  const ms = now - at;
  if (!Number.isFinite(ms)) return "";
  if (ms < 60000) return t("just now");
  if (ms < 24 * 3600e3) return t("{time} ago", { time: formatDuration(ms) });
  const days = Math.floor(ms / (24 * 3600e3));
  if (days === 1) return t("yesterday");
  if (days < 60) return t("{n} days ago", { n: days });
  return formatDate(at, { weekday: false, year: true });
}
