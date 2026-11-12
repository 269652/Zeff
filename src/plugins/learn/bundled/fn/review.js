// Spaced repetition (SM-2, as Anki's ancestor), the same rules as Zeff's own Learn: a card comes back when you are about to forget it.
// inputs: { reps, lapses, ease, interval, grade: "again" | "hard" | "good" | "easy", today?: "YYYY-MM-DD" }  ->  the card's new state.
const MIN_EASE = 1.3;
const day = (today, plus) => {
  const t = new Date(`${today}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + plus);
  return t.toISOString().slice(0, 10);
};
const today = inputs.today || new Date().toISOString().slice(0, 10);
const c = { reps: Number(inputs.reps) || 0, lapses: Number(inputs.lapses) || 0, ease: Number(inputs.ease) || 2.5, interval: Number(inputs.interval) || 0 };
const grade = String(inputs.grade || "good");
if (!["again", "hard", "good", "easy"].includes(grade)) throw new Error(`grade is again, hard, good or easy - not "${grade}"`);
if (grade === "again") return { reps: 0, lapses: c.lapses + 1, ease: Math.max(MIN_EASE, c.ease - 0.2), interval: 0, due: today, last: today };
const q = grade === "hard" ? 3 : grade === "good" ? 4 : 5;
const ease = Math.max(MIN_EASE, c.ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
let interval;
if (c.reps === 0) interval = grade === "easy" ? 3 : 1;
else if (c.reps === 1) interval = grade === "hard" ? 4 : grade === "easy" ? 8 : 6;
else interval = Math.max(c.interval + 1, Math.round(c.interval * (grade === "hard" ? 1.2 : grade === "easy" ? ease * 1.3 : ease)));
return { reps: c.reps + 1, lapses: c.lapses, ease: Math.round(ease * 1000) / 1000, interval, due: day(today, interval), last: today };
