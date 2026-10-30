import { parseLocalDateTime } from "@/lib/calendar/meetings";
import { localStamp } from "@/lib/dates";

/**
 * Where the appointments the actions review suggests go: into a free time from the one asked for — clear of my appointments and of
 * those placed before, and at most `perDay` a day (more go to the next day with room, at the time asked for), so a day isn't filled
 * with suggestions from morning to night.
 */

/** When an appointment may go: work ones on workdays 9–17, private ones (Zeff's calendar, Google) any day 8–21. */
export type Window = { workdays: boolean; from: number; to: number };
export const WORK_WINDOW: Window = { workdays: true, from: 9, to: 17 };
export const PRIVATE_WINDOW: Window = { workdays: false, from: 8, to: 21 };

/** At most this many suggested appointments a day. */
export const SUGGESTIONS_PER_DAY = 3;

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/**
 * An appointment's start, moved to the first free time from the one asked for: in its window, not before now, clear of my
 * appointments (`busy`) and of those already placed (`taken` — it is added there), on a day with fewer than `perDay` placed.
 */
export function placeAppointment(start: string, minutes: number, busy: { start: Date; end: Date }[], taken: { start: Date; end: Date }[], window: Window = WORK_WINDOW, perDay = SUGGESTIONS_PER_DAY): string {
  const wanted = parseLocalDateTime(start.length === 16 ? `${start}:00` : start);
  const now = new Date();
  now.setMinutes(Math.ceil(now.getMinutes() / 15) * 15, 0, 0);
  let t = new Date(Math.max(wanted.getTime(), now.getTime()));
  for (let i = 0; i < 4 * 24 * 60; i++) {
    // A day with its share already: the next day, at the time asked for.
    if (perDay > 0 && taken.filter((b) => dayKey(b.start) === dayKey(t)).length >= perDay) {
      const next = new Date(t);
      next.setDate(next.getDate() + 1);
      next.setHours(wanted.getHours(), wanted.getMinutes(), 0, 0);
      t = next;
      continue;
    }
    const end = new Date(t.getTime() + minutes * 60000);
    const day = t.getDay();
    const inHours = t.getHours() >= window.from && (end.getHours() < window.to || (end.getHours() === window.to && end.getMinutes() === 0)) && end.getDate() === t.getDate();
    const clash = [...busy, ...taken].some((b) => t < b.end && end > b.start);
    if ((!window.workdays || (day >= 1 && day <= 5)) && inHours && !clash) {
      taken.push({ start: t, end });
      return localStamp(t);
    }
    t = new Date(t.getTime() + 15 * 60000);
  }
  return start;
}

/** Whether a todo gets appointment suggestions: not an agent's follow-up (its work, not a time of mine). */
export const appointmentsAllowed = (t: { source?: string | null }): boolean => !/^(Follow-up from W-|Planned after )/.test(t.source ?? "");
