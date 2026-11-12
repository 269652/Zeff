// The game in learning, as in Zeff's own Learn: levels from experience, the streak of days, a daily goal, badges.
// inputs: { op: "level", xp } | { op: "streak", streak, lastDay, today } | { op: "daily", xp, goal } | { op: "badges", stats: {...} }
const levelCost = (level) => Math.round((100 * Math.pow(1.25, level - 1)) / 10) * 10;
const nextDay = (d) => {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
};
const BADGES = [
  ["first-step", (s) => s.stepsMastered >= 1],
  ["first-skill", (s) => s.skillsMastered >= 1],
  ["first-phase", (s) => s.phasesMastered >= 1],
  ["first-year", (s) => s.yearsMastered >= 1],
  ["streak-7", (s) => s.streak >= 7],
  ["streak-30", (s) => s.streak >= 30],
  ["reviews-100", (s) => s.reviews >= 100],
  ["reviews-1000", (s) => s.reviews >= 1000],
  ["widgets-10", (s) => s.widgets >= 10],
  ["course-done", (s) => !!s.courseDone],
];
switch (inputs.op) {
  case "level": {
    let level = 1;
    let rest = Math.max(0, Math.floor(Number(inputs.xp) || 0));
    while (rest >= levelCost(level) && level < 999) rest -= levelCost(level++);
    const need = levelCost(level);
    return { level, into: rest, need, share: rest / need };
  }
  case "streak": {
    const prev = { streak: Number(inputs.streak) || 0, lastDay: inputs.lastDay || null };
    const today = String(inputs.today);
    if (prev.lastDay === today) return { streak: Math.max(1, prev.streak), lastDay: today };
    if (prev.lastDay && nextDay(prev.lastDay) === today) return { streak: prev.streak + 1, lastDay: today };
    return { streak: 1, lastDay: today };
  }
  case "daily": {
    const goal = Math.max(1, Number(inputs.goal) || 50);
    const xp = Number(inputs.xp) || 0;
    return { xp, goal, share: Math.min(1, xp / goal), reached: xp >= goal };
  }
  case "badges": {
    const s = inputs.stats || {};
    return BADGES.filter(([, earned]) => earned(s)).map(([id]) => id);
  }
  default:
    throw new Error('op is "level", "streak", "daily" or "badges"');
}
