/**
 * The Kalender app's views — what they share: the views and their ranges, the items they show (an
 * appointment of a calendar, a todo's proposed one), side-by-side lanes for overlaps, dates and
 * times as they're written, snapping. Client-safe.
 */

/** A window event: appointments changed from outside a calendar view (a Think along card set up or took back proposals) — the views on the page read again. */
export const CALENDAR_CHANGED = "zeff:calendar-changed";
import { pad2 as two } from "@/lib/text";
import { optionOf, type CalendarEventView, type CalendarView, type ProposedEvent } from "@/lib/calendar/ir-shared";
import { addDays, weekdayOf } from "@/lib/calendar/recurrence";
import { currentLocale, formatDate } from "@/lib/format";
import type { T } from "@/lib/i18n/shared";
import { localDay } from "@/lib/dates";

export const VIEWS = ["day", "week", "month", "agenda"] as const;
export type ViewKind = (typeof VIEWS)[number];
export const isView = (v: unknown): v is ViewKind => (VIEWS as readonly unknown[]).includes(v);
/** The views' names in the language of `t`. */
export const viewLabels = (t: T): Record<ViewKind, string> => ({ day: t("Day"), week: t("Week"), month: t("Month"), agenda: t("Agenda") });

/** The weekdays' names, Monday first, in the locale dates are shown in ("Mon", "M" …). */
export const weekdayHeads = (weekday: "long" | "short" | "narrow", locale = currentLocale()) =>
  Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(locale, { weekday }));

/** An appointment as a view shows it: a calendar's (one occurrence of a series is one item), or one a todo proposes. */
export type Item = {
  /** Unique in the view: "e<id>" (an occurrence: "e<id>@<day>"), "p<n>". */
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  color: string;
  /** Changeable here: Zeff's own calendars, and your events in Google's you may write to (an invitation is answered; the others open in their source). */
  editable: boolean;
  event?: CalendarEventView;
  calendar?: CalendarView;
  proposed?: ProposedEvent;
  /** A Done item that matches this meeting, merged into it (see mergeDone). */
  merged?: Item;
};

/** A proposal (dashed, "Proposed"): a calendar's proposed appointment (accept / dismiss), or one a todo proposes. */
export const isProposal = (it: Pick<Item, "proposed" | "event">): boolean => !!it.proposed || !!it.event?.proposed;

/** A proposal's title as the views show it: "Proposed: …" — one of several options: "Option A: …". */
export const proposalTitle = (it: Pick<Item, "proposed" | "event" | "title">, t: T): string => {
  const opt = it.event?.proposed ? optionOf(it.event.key) : null;
  return opt ? t("Option {letter}: {title}", { letter: opt.letter, title: it.title }) : t("Proposed: {title}", { title: it.title });
};
/** An item's title: a proposal's said so. */
export const shownTitle = (it: Pick<Item, "proposed" | "event" | "title">, t: T): string => (isProposal(it) ? proposalTitle(it, t) : it.title);

/** The actions that are an appointment and can be moved by dragging (their start and length are in the action). */
const MOVABLE_PROPOSALS = new Set(["calendar-event", "gcal-event", "calendar-entry"]);

/**
 * What a view shows: the appointments of the calendars switched on (not cancelled), in their calendar's colour — Zeff's own
 * changeable — and, when wanted, the proposals: a calendar's proposed appointments (dashed), those todos propose. `moved`: dragged here, shown where they went until the server has them.
 */
export function calendarItems(
  events: CalendarEventView[],
  proposed: ProposedEvent[],
  calendars: CalendarView[],
  shown: (c: CalendarView) => boolean,
  showProposed: boolean,
  moved: Record<string, { start: string; end: string }> = {},
): Item[] {
  const byId = new Map(calendars.map((c) => [c.id, c]));
  return [
    ...events
      .filter((e) => !e.cancelled && byId.has(e.calendarId) && shown(byId.get(e.calendarId)!) && (showProposed || !e.proposed))
      .map((e): Item => {
        const id = e.occurrence ? `e${e.id}@${e.occurrence}` : `e${e.id}`;
        const cal = byId.get(e.calendarId);
        return { id, title: e.title, start: moved[id]?.start ?? e.start, end: moved[id]?.end ?? e.end, allDay: e.allDay, color: cal?.color ?? "#7A869A", editable: cal?.source === "zeff" || e.proposed || (!!cal?.writable && (!e.response || e.response === "organizer")), event: e, calendar: cal };
      }),
    // An appointment a todo proposes can be dragged like one of Zeff's own: its action gets the new time.
    ...(showProposed ? proposed.map((p, i): Item => ({ id: `p${i}`, title: p.title, start: moved[`p${i}`]?.start ?? p.start, end: moved[`p${i}`]?.end ?? p.end, allDay: false, color: "#6366F1", editable: MOVABLE_PROPOSALS.has(p.type), proposed: p })) : []),
  ];
}

export const local = (s: string) => new Date(s.length === 10 ? `${s}T00:00:00` : `${s.slice(0, 16)}:00`);
export const ymd = localDay;
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
  const locale = currentLocale();
  if (view === "day") return d.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  if (view === "month") return d.toLocaleDateString(locale, { month: "long", year: "numeric" });
  const { days } = viewRange(view, day);
  const a = local(days[0]);
  const b = local(days[days.length - 1]);
  const sameMonth = a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  return `${a.toLocaleDateString(locale, sameMonth ? { day: "numeric" } : { day: "numeric", month: "short", ...(a.getFullYear() !== b.getFullYear() ? { year: "numeric" } : {}) })} – ${b.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })}`;
}

export const timeText = (s: string) => (s.length === 10 ? "" : s.slice(11, 16));

/** "Mon 12 Oct, 09:00 – 10:30", "Mon 12 Oct – Wed 14 Oct · all day" — in the language of `t`. */
export function whenText(it: Pick<Item, "start" | "end" | "allDay">, t: T): string {
  const day = (s: string) => formatDate(local(s));
  if (it.allDay) {
    const last = addDays(it.end, -1);
    return last > it.start ? t("{from} – {to} · all day", { from: day(it.start), to: day(last) }) : t("{day} · all day", { day: day(it.start) });
  }
  return it.start.slice(0, 10) === it.end.slice(0, 10) || (it.end.slice(11) === "00:00" && addDays(it.start.slice(0, 10), 1) === it.end.slice(0, 10))
    ? `${day(it.start)}, ${timeText(it.start)} – ${timeText(it.end)}`
    : `${day(it.start)} ${timeText(it.start)} – ${day(it.end)} ${timeText(it.end)}`;
}

/** "45 min", "1 h", "1 h 30 min" — in the language of `t`. */
export const durationText = (minutes: number, t: T) =>
  minutes < 60 ? t("{n} min", { n: minutes }) : minutes % 60 ? t("{h} h {m} min", { h: Math.floor(minutes / 60), m: minutes % 60 }) : t("{n} h", { n: minutes / 60 });

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

/** The key of the Done calendar (what Zeff derives from the entries: src/lib/calendar/done.ts). */
export const DONE_CALENDAR = "zeff:done";

/**
 * A Done item that matches a meeting — they cover mostly the same time (the overlap is at least 3/4
 * of the shorter one) — is merged into it: the meeting is shown once, with the Done item as `merged`
 * (the view draws the green stripes over its colour). One Done item per meeting (the closest match),
 * and a meeting takes one. What matches nothing stays as it is.
 */
export function mergeDone<T extends Pick<Item, "start" | "end" | "calendar" | "proposed" | "allDay"> & { merged?: Item }>(items: T[]): T[] {
  const isDone = (i: T) => i.calendar?.key === DONE_CALENDAR;
  const meetings = items.filter((i) => !isDone(i) && !i.proposed && !i.allDay);
  const took = new Map<T, { done: T; score: number }>();
  for (const d of items.filter(isDone)) {
    let best: { m: T; score: number } | null = null;
    for (const m of meetings) {
      if (d.start.slice(0, 10) !== m.start.slice(0, 10)) continue;
      const dd = minutesBetween(d.start, d.end);
      const dm = minutesBetween(m.start, m.end);
      const overlap = Math.min(minutesOf(d.end), minutesOf(m.end)) - Math.max(minutesOf(d.start), minutesOf(m.start));
      const shorter = Math.min(dd, dm);
      if (shorter <= 0 || overlap / shorter < 0.75) continue;
      // The closest one: the most of both covered (overlap over the time they take together).
      const score = overlap / (dd + dm - overlap);
      if (!best || score > best.score) best = { m, score };
    }
    if (best && best.score > (took.get(best.m)?.score ?? 0)) took.set(best.m, { done: d, score: best.score });
  }
  const gone = new Set([...took.values()].map((t) => t.done));
  return items.filter((i) => !gone.has(i)).map((i) => (took.has(i) ? { ...i, merged: took.get(i)!.done as unknown as Item } : i));
}

/** What a screen reader says for an appointment's block: title, when, calendar (not the title alone). */
export function itemLabel(it: Item, t: T): string {
  return [shownTitle(it, t), whenText(it, t), it.calendar?.name].filter(Boolean).join(", ");
}
