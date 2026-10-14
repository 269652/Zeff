/**
 * Heute's day view: the working day as a stretch of time with the meetings on it, how far it is,
 * and the free windows left in it (where focused work fits). Pure: the page gathers, this computes
 * (tests/heute-day.test.ts).
 */

export type DayMeeting = { subject: string; start: string; end: string; online: boolean };
export type Span = { from: number; to: number };

/** The window of the day shown: 7:00–19:00, wider when a meeting reaches outside it. */
export function dayFrame(now: number, meetings: DayMeeting[], startHour = 7, endHour = 19): Span {
  const d = new Date(now);
  let from = new Date(d.getFullYear(), d.getMonth(), d.getDate(), startHour).getTime();
  let to = new Date(d.getFullYear(), d.getMonth(), d.getDate(), endHour).getTime();
  for (const m of meetings) {
    const s = Date.parse(m.start);
    const e = Date.parse(m.end);
    if (s < from) from = new Date(new Date(s).setMinutes(0, 0, 0)).getTime();
    if (e > to) to = new Date(new Date(e).setMinutes(0, 0, 0) + 3600e3).getTime();
  }
  return { from, to };
}

/** Where a time falls in the frame: 0–100 (clamped). */
export const pct = (ms: number, frame: Span) => Math.max(0, Math.min(100, ((ms - frame.from) / (frame.to - frame.from)) * 100));

/**
 * The stretches of the working day (`work`, 8:00–18:00 unless given) still free: from now on, not
 * inside a meeting, at least `minMinutes` long. Overlapping meetings count once.
 */
export function freeWindows(meetings: DayMeeting[], now: number, work: Span, minMinutes = 45): Span[] {
  const busy = meetings
    .map((m) => ({ from: Date.parse(m.start), to: Date.parse(m.end) }))
    .filter((s) => s.to > s.from)
    .sort((a, b) => a.from - b.from);
  const out: Span[] = [];
  let cursor = Math.max(work.from, now);
  for (const b of busy) {
    if (b.to <= cursor) continue;
    if (b.from > cursor) out.push({ from: cursor, to: Math.min(b.from, work.to) });
    cursor = Math.max(cursor, b.to);
    if (cursor >= work.to) break;
  }
  if (cursor < work.to) out.push({ from: cursor, to: work.to });
  return out.filter((w) => w.to - w.from >= minMinutes * 60e3);
}

/** The working day (8:00–18:00) of the day `now` is in. */
export function workSpan(now: number, startHour = 8, endHour = 18): Span {
  const d = new Date(now);
  return { from: new Date(d.getFullYear(), d.getMonth(), d.getDate(), startHour).getTime(), to: new Date(d.getFullYear(), d.getMonth(), d.getDate(), endHour).getTime() };
}

/** How much of the working day has passed: 0–1. */
export const dayProgress = (now: number, work: Span) => Math.max(0, Math.min(1, (now - work.from) / (work.to - work.from)));

export type DayPhase = "night" | "morning" | "day" | "evening";
export const phaseOf = (now: number): DayPhase => {
  const h = new Date(now).getHours();
  return h < 5 ? "night" : h < 11 ? "morning" : h < 17 ? "day" : "evening";
};
