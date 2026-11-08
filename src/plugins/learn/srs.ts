/**
 * Spaced repetition (SM-2, as Anki's ancestor): a card comes back when you're about to forget it — a day after the first
 * good answer, about six after the second, then further apart by the card's ease; "again" starts it over and makes it
 * harder, "hard" and "easy" bend the interval and the ease. Pure.
 */
export type Grade = "again" | "hard" | "good" | "easy";
export type CardState = { reps: number; lapses: number; ease: number; interval: number; due: string; last: string | null };

const MIN_EASE = 1.3;
const DAY = 864e5;

const plusDays = (now: Date, days: number) => new Date(now.getTime() + days * DAY).toISOString();

export const newCard = (now: Date): CardState => ({ reps: 0, lapses: 0, ease: 2.5, interval: 0, due: now.toISOString(), last: null });

export const isDue = (c: Pick<CardState, "due">, now: Date) => new Date(c.due).getTime() <= now.getTime();

export function review(c: CardState, grade: Grade, now: Date): CardState {
  if (grade === "again") {
    return { reps: 0, lapses: c.lapses + 1, ease: Math.max(MIN_EASE, c.ease - 0.2), interval: 0, due: now.toISOString(), last: now.toISOString() };
  }
  const q = grade === "hard" ? 3 : grade === "good" ? 4 : 5;
  // SM-2's ease change (q 3: −0.14, 4: ±0, 5: +0.1).
  const ease = Math.max(MIN_EASE, c.ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
  let interval: number;
  if (c.reps === 0) interval = grade === "easy" ? 3 : 1;
  else if (c.reps === 1) interval = grade === "hard" ? 4 : grade === "easy" ? 8 : 6;
  else interval = Math.max(c.interval + 1, Math.round(c.interval * (grade === "hard" ? 1.2 : grade === "easy" ? ease * 1.3 : ease)));
  return { reps: c.reps + 1, lapses: c.lapses, ease, interval, due: plusDays(now, interval), last: now.toISOString() };
}
