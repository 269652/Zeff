/**
 * The game in learning: experience and levels, the streak of days you learned, a daily goal, badges. Pure.
 */

/** Experience a level takes: 100 for the first, each next one 25% more (rounded to tens). */
const levelCost = (level: number) => Math.round((100 * Math.pow(1.25, level - 1)) / 10) * 10;

/** Your level for an amount of experience: the level, how far into it, what it takes, as a share. */
export function levelOf(xp: number): { level: number; into: number; need: number; share: number } {
  let level = 1;
  let rest = Math.max(0, Math.floor(xp));
  while (rest >= levelCost(level) && level < 999) rest -= levelCost(level++);
  const need = levelCost(level);
  return { level, into: rest, need, share: rest / need };
}

/** The day after a day (YYYY-MM-DD). */
const nextDay = (d: string) => {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
};

/** The streak after learning on `today`: the same day keeps it, the next day adds one, a gap starts over. */
export function nextStreak(prev: { streak: number; lastDay: string | null }, today: string): { streak: number; lastDay: string } {
  if (prev.lastDay === today) return { streak: Math.max(1, prev.streak), lastDay: today };
  if (prev.lastDay && nextDay(prev.lastDay) === today) return { streak: prev.streak + 1, lastDay: today };
  return { streak: 1, lastDay: today };
}

/** Today's experience against the daily goal. */
export function dailyProgress(xp: number, goal: number): { xp: number; goal: number; share: number; reached: boolean } {
  const g = Math.max(1, goal);
  return { xp, goal: g, share: Math.min(1, xp / g), reached: xp >= g };
}

/** The badges there are, in the order they're shown, with what earns each. */
export const BADGES = [
  { id: "first-step", earned: (s: BadgeStats) => s.stepsMastered >= 1 },
  { id: "first-skill", earned: (s: BadgeStats) => s.skillsMastered >= 1 },
  { id: "first-phase", earned: (s: BadgeStats) => s.phasesMastered >= 1 },
  { id: "first-year", earned: (s: BadgeStats) => s.yearsMastered >= 1 },
  { id: "streak-7", earned: (s: BadgeStats) => s.streak >= 7 },
  { id: "streak-30", earned: (s: BadgeStats) => s.streak >= 30 },
  { id: "reviews-100", earned: (s: BadgeStats) => s.reviews >= 100 },
  { id: "reviews-1000", earned: (s: BadgeStats) => s.reviews >= 1000 },
  { id: "widgets-10", earned: (s: BadgeStats) => s.widgets >= 10 },
  { id: "course-done", earned: (s: BadgeStats) => s.courseDone },
] as const;
export type BadgeId = (typeof BADGES)[number]["id"];
export type BadgeStats = { stepsMastered: number; skillsMastered: number; phasesMastered: number; yearsMastered: number; streak: number; reviews: number; widgets: number; courseDone: boolean };

export const badgesFor = (s: BadgeStats): BadgeId[] => BADGES.filter((b) => b.earned(s)).map((b) => b.id);
