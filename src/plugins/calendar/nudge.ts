/**
 * Keyboard moves of an appointment (the single-pointer alternative to dragging): Alt+↑/↓ ±15
 * minutes, Alt+←/→ ±1 day, Shift+Alt+↑/↓ the end ±15 minutes. Pure; client-safe.
 */
import { addDays } from "@/lib/calendar/recurrence";
import { minutesBetween, plus } from "./view-shared";

export const NUDGE_STEP = 15;

export type Nudge = { dMinutes?: number; dDays?: number; resize?: boolean };

/** The nudge a key means (with Alt held), or null. */
export function nudgeOf(key: string, shift: boolean): Nudge | null {
  if (key === "ArrowUp") return shift ? { dMinutes: -NUDGE_STEP, resize: true } : { dMinutes: -NUDGE_STEP };
  if (key === "ArrowDown") return shift ? { dMinutes: NUDGE_STEP, resize: true } : { dMinutes: NUDGE_STEP };
  if (!shift && key === "ArrowLeft") return { dDays: -1 };
  if (!shift && key === "ArrowRight") return { dDays: 1 };
  return null;
}

/** The new start and end after a nudge; null when nothing changes (a resize can't go under one step). */
export function nudged(start: string, end: string, allDay: boolean, n: Nudge): { start: string; end: string } | null {
  if (allDay) {
    const d = n.dDays ?? 0;
    return d && !n.resize ? { start: addDays(start, d), end: addDays(end, d) } : null;
  }
  if (n.resize) {
    const e = plus(end, n.dMinutes ?? 0);
    return minutesBetween(start, e) >= NUDGE_STEP ? { start, end: e } : null;
  }
  const delta = (n.dMinutes ?? 0) + (n.dDays ?? 0) * 1440;
  return delta ? { start: plus(start, delta), end: plus(end, delta) } : null;
}
