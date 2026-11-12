// What an exercise reported (zeff.report): the best score is kept, every try's answers are kept, and doing better than before earns
// experience - at most 5 XP an exercise, and only for what is more than it has given so far.
// Every try is kept (its answers, and the widget as it looked) for the lesson's timeline.
// inputs: { exercise: id, score: 0..1, correct?, total?, note?, done?, answers?: JSON text, snapshot?: html }
const EXERCISES = "@learn-ext.i10";
const STEPS = "@learn-ext.i3";
const TRIES = "@learn-ext.i20";
const db = await zeff.database(EXERCISES);
const col = (name) => db.cols.indexOf(name);
const want = String(inputs.exercise).trim();
const at = db.ids.findIndex((id) => String(id) === want);
if (at < 0) throw new Error(`There is no exercise ${inputs.exercise}.`);
const row = db.rows[at];
const score = Math.max(0, Math.min(1, Number(inputs.score) || 0));
const best = Math.max(Number(row[col("Best")]) || 0, score);
const given = Number(row[col("XP")]) || 0;
const gain = Math.max(0, Math.round(5 * best) - given);
await zeff.updateRow(EXERCISES, db.ids[at], { Best: best, XP: given + gain, Last: JSON.stringify({ score, correct: inputs.correct ?? null, total: inputs.total ?? null, note: inputs.note || "", done: !!inputs.done, answers: (() => { try { return JSON.parse(inputs.answers || "[]"); } catch { return []; } })() }).slice(0, 20000) });
await zeff.addRow(TRIES, { Try: `${row[0]} - ${Math.round(score * 100)} %`, Exercise: db.ids[at], Step: String(row[col("Step")]), Title: String(row[0]), Score: score, Correct: inputs.correct ?? null, Total: inputs.total ?? null, Note: String(inputs.note || "").slice(0, 1000), Answers: String(inputs.answers || "[]").slice(0, 19000), Snapshot: String(inputs.snapshot || "").slice(0, 1500000), At: new Date().toISOString().slice(0, 16).replace("T", " ") });
let level = null;
if (gain > 0) {
  const steps = await zeff.database(STEPS);
  const s = steps.rows.findIndex((r) => String(r[0]) === String(row[col("Step")]));
  const award = await zeff.call("learn-ext", "award", { course: s >= 0 ? steps.rows[s][steps.cols.indexOf("Course")] || undefined : undefined, xp: gain, why: `exercise: ${row[0]}` });
  level = award.level;
}
return { exercise: row[0], best, gain, level, notice: gain > 0 ? `+${gain} XP - ${row[0]}` : "" };
