/** Study times, pure (schedule.ts puts them into the calendar). Client-safe. */
import { localStamp } from "@/lib/dates";
import type { EventInput } from "@/lib/calendar/ir";

/** A study time: weekday 1 (Monday) – 7 (Sunday), HH:MM, minutes. */
export type StudySlot = { day: number; time: string; minutes: number };

/** How far ahead the calendar holds them. */
export const WEEKS = 4;

/** Slots as they may be kept: a weekday 1 (Monday) – 7 (Sunday), a time HH:MM, 10–240 minutes. */
export function cleanSlots(raw: unknown): StudySlot[] {
  const out: StudySlot[] = [];
  for (const s of Array.isArray(raw) ? raw.slice(0, 21) : []) {
    const r = (s ?? {}) as Record<string, unknown>;
    const day = Number(r.day);
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(r.time ?? ""));
    if (!Number.isInteger(day) || day < 1 || day > 7 || !m || Number(m[1]) > 23 || Number(m[2]) > 59) continue;
    const minutes = Math.max(10, Math.min(240, Math.round(Number(r.minutes) || 30)));
    out.push({ day, time: `${m[1].padStart(2, "0")}:${m[2]}`, minutes });
  }
  return out;
}

/** The study appointments of courses from `from` (its day) for `days` days. */
export function studyEvents(courses: { id: number; title: string; slots: StudySlot[] }[], from: Date, days = WEEKS * 7): EventInput[] {
  const events: EventInput[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
    const weekday = d.getDay() === 0 ? 7 : d.getDay();
    for (const c of courses) {
      for (const s of c.slots) {
        if (s.day !== weekday) continue;
        const [h, m] = s.time.split(":").map(Number);
        const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m);
        const end = new Date(start.getTime() + s.minutes * 60_000);
        events.push({ key: `learn:${c.id}:${localStamp(start)}`, title: `Lernen: ${c.title}`, start: localStamp(start), end: localStamp(end), description: `/learn/${c.id}` });
      }
    }
  }
  return events.sort((a, b) => a.start.localeCompare(b.start));
}

