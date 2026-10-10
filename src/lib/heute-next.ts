/**
 * Heute's "Als Nächstes": what's next across everything the page knows, in one list, most pressing
 * first — a meeting now, an agent asking, what's overdue or due today, people waiting long, a date
 * coming up (a birthday, from the Personen plugin's reminders), and booking the day when it's late
 * and hours are missing.
 * Pure: the page gathers, this ranks (tests/heute-next.test.ts).
 */

import { formatHours, formatTime, roundQuarter } from "./format";

export type NextTone = "red" | "amber" | "indigo" | "zinc";
/** href "": nothing to open (a fact). */
export type NextItem = { key: string; title: string; detail: string; href: string; tone: NextTone };

type Todo = { id: number; ref: string; text: string; due: string | null; flaggedAt: string | null };
type Meeting = { subject: string; start: string; end: string };
type Waiting = { key: string; who: string; text: string; since: string; count: number; href: string; source: string };
/** A date coming up (a birthday …): days from today; href "" — nothing to open. */
type DateSoon = { key: string; title: string; inDays: number; href: string };

export type NextInput = {
  now: number;
  asking: Todo[];
  /** Your open todos. */
  mine: Todo[];
  meetings: Meeting[];
  unanswered: Waiting[];
  dates: DateSoon[];
  hours: { booked: number; target: number } | null;
  /** Weeks to close (Wochenabschluss): the one ending today, last week early in this one — with steps left. */
  weeks?: { key: string; title: string; open: number; href: string }[];
};

const DAY = 864e5;
const midnight = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
/** Whole days from today (at `now`) to a YYYY-MM-DD — negative: past. */
const daysTo = (day: string, now: number) => Math.round((new Date(`${day}T00:00:00`).getTime() - midnight(now)) / DAY);
const since = (iso: string, now: number) => {
  const h = Math.floor((now - Date.parse(iso)) / 3600e3);
  const days = Math.floor(h / 24);
  return h < 24 ? `for ${Math.max(1, h)} h` : `for ${days} ${days === 1 ? "day" : "days"}`;
};

/** Ranked: lower first; within a rank, the earlier (or longer waiting) first. */
export function nextUp(input: NextInput, limit = 6): NextItem[] {
  const { now } = input;
  const out: { rank: number; at: number; item: NextItem }[] = [];
  const add = (rank: number, at: number, item: NextItem) => out.push({ rank, at, item });
  const todoHref = (t: Todo) => `/t/${t.id}`;

  // A meeting on now, or starting within 15 minutes: first.
  for (const m of input.meetings) {
    const start = Date.parse(m.start);
    const end = Date.parse(m.end);
    if (now >= start && now < end) add(0, start, { key: `m:${m.start}`, title: m.subject, detail: `now · until ${formatTime(end)}`, href: "/calendar", tone: "red" });
    else if (start > now && start - now <= 15 * 60e3) add(0, start, { key: `m:${m.start}`, title: m.subject, detail: `in ${Math.ceil((start - now) / 60e3)} min`, href: "/calendar", tone: "red" });
    else if (start > now && start - now <= 60 * 60e3) add(4, start, { key: `m:${m.start}`, title: m.subject, detail: `at ${formatTime(start)}`, href: "/calendar", tone: "amber" });
  }
  for (const t of input.asking) add(1, 0, { key: `a:${t.id}`, title: t.text, detail: `${t.ref} · an agent asks you`, href: todoHref(t), tone: "red" });
  const asked = new Set(input.asking.map((t) => t.id));
  for (const t of input.mine) {
    if (asked.has(t.id)) continue;
    const d = t.due ? daysTo(t.due, now) : null;
    if (d !== null && d < 0) add(2, d, { key: `t:${t.id}`, title: t.text, detail: `${t.ref} · overdue (${-d} ${d === -1 ? "day" : "days"})`, href: todoHref(t), tone: "red" });
    else if (d === 0) add(3, 0, { key: `t:${t.id}`, title: t.text, detail: `${t.ref} · due today`, href: todoHref(t), tone: "red" });
    else if (d === 1) add(7, 1, { key: `t:${t.id}`, title: t.text, detail: `${t.ref} · due tomorrow`, href: todoHref(t), tone: "amber" });
    else if (t.flaggedAt) add(7, 2, { key: `t:${t.id}`, title: t.text, detail: `${t.ref} · important`, href: todoHref(t), tone: "amber" });
  }
  // People waiting for your answer for four hours or more — the longest first.
  for (const w of input.unanswered) {
    if (now - Date.parse(w.since) < 4 * 3600e3) continue;
    add(5, Date.parse(w.since), {
      key: `w:${w.key}`,
      title: `Reply to ${w.who}`,
      detail: `${w.source} · ${w.count > 1 ? `${w.count} messages · ` : ""}${since(w.since, now)}`,
      href: w.href,
      tone: now - Date.parse(w.since) >= DAY ? "amber" : "zinc",
    });
  }
  // A date coming up (a birthday …) in the next seven days.
  for (const x of input.dates) {
    if (x.inDays < 0 || x.inDays > 7) continue;
    add(6, x.inDays, { key: `d:${x.key}`, title: x.title, detail: x.inDays === 0 ? "today" : x.inDays === 1 ? "tomorrow" : `in ${x.inDays} days`, href: x.href, tone: x.inDays <= 1 ? "red" : "indigo" });
  }
  // Late in the day with hours missing: book it.
  const hour = new Date(now).getHours();
  if (input.hours && hour >= 16 && input.hours.target > 0 && input.hours.booked < input.hours.target - 0.25)
    add(8, 0, { key: "book", title: "Book the day", detail: `${fmt(input.hours.booked)} of ${fmt(input.hours.target)} h booked`, href: "/feierabend", tone: "indigo" });

  for (const w of input.weeks ?? []) if (w.open > 0) add(8, 1, { key: `wk:${w.key}`, title: w.title, detail: `${w.open} ${w.open === 1 ? "step" : "steps"} open`, href: w.href, tone: "indigo" });

  return out
    .sort((a, b) => a.rank - b.rank || a.at - b.at)
    .slice(0, limit)
    .map((x) => x.item);
}

const fmt = (h: number) => formatHours(roundQuarter(h));
