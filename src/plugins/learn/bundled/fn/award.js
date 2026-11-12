// Experience for a course: its XP, level, streak, today's XP and badges follow, and an Activity row says what was earned.
// inputs: { course?: title or id (the first course when left out), xp: number, why?: text, detail?: text, today?: "YYYY-MM-DD" }
const COURSES = "@learn-ext.i2";
const ACTIVITY = "@learn-ext.i5";
const CARDS = "@learn-ext.i4";
const EXERCISES = "@learn-ext.i10";
const today = inputs.today || new Date().toISOString().slice(0, 10);
const xp = Math.max(0, Math.floor(Number(inputs.xp) || 0));
const db = await zeff.database(COURSES);
if (!db.rows.length) throw new Error("There is no course yet - make one first.");
const col = (name) => db.cols.indexOf(name);
let at = 0;
if (inputs.course !== undefined && inputs.course !== null && inputs.course !== "") {
  // (A relation reads as its titles, or "#12" where the title is not known: the first one counts.)
  const want = String(inputs.course).split(",")[0].trim().replace(/^#/, "").toLowerCase();
  at = db.rows.findIndex((r, i) => String(db.ids[i]) === want || String(r[0]).trim().toLowerCase() === want);
  if (at < 0) throw new Error(`There is no course "${inputs.course}".`);
}
const row = db.rows[at];
const num = (name) => Number(row[col(name)]) || 0;
const total = num("XP") + xp;
const level = await zeff.call("learn-ext", "game", { op: "level", xp: total });
const streak = await zeff.call("learn-ext", "game", { op: "streak", streak: num("Streak"), lastDay: row[col("LastDay")] || null, today });
const todayXp = (row[col("LastDay")] === today ? num("TodayXP") : 0) + xp;

// Badges: from what has been done in the course.
const state = await zeff.call("learn-ext", "state", { course: String(row[0]) });
const count = (kind) => state.nodes.filter((n) => n.kind === kind && n.status === "mastered").length;
const cards = await zeff.database(CARDS);
const ex = await zeff.database(EXERCISES);
const stats = {
  stepsMastered: count("step"),
  skillsMastered: count("skill"),
  phasesMastered: count("phase"),
  yearsMastered: count("year"),
  streak: streak.streak,
  reviews: cards.rows.reduce((s, r) => s + (Number(r[cards.cols.indexOf("Reps")]) || 0), 0),
  widgets: ex.rows.filter((r) => (Number(r[ex.cols.indexOf("Best")]) || 0) > 0).length,
  courseDone: state.nodes.length > 0 && state.nodes.every((n) => n.status === "mastered"),
};
const badges = await zeff.call("learn-ext", "game", { op: "badges", stats });
await zeff.updateRow(COURSES, db.ids[at], { XP: total, Level: level.level, Streak: streak.streak, LastDay: today, TodayXP: todayXp, Badges: badges });
if (xp > 0 || inputs.why) await zeff.addRow(ACTIVITY, { Event: String(inputs.why || "xp").slice(0, 80), At: today, XP: xp, Detail: String(inputs.detail || row[0]).slice(0, 2000) });
return { course: row[0], xp: total, gained: xp, level: level.level, streak: streak.streak, today: todayXp, badges };
