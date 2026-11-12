// A card answered: when it comes back is worked out (SM-2) and written to the card, and the review earns a little experience.
// inputs: { card: id or front text, grade: "again" | "hard" | "good" | "easy", course?: title, today?: "YYYY-MM-DD" }
const CARDS = "@learn-ext.i4";
const db = await zeff.database(CARDS);
const col = (name) => db.cols.indexOf(name);
const want = String(inputs.card).trim().toLowerCase();
const at = db.rows.findIndex((r, i) => String(db.ids[i]) === want || String(r[0]).trim().toLowerCase() === want);
if (at < 0) throw new Error(`There is no card "${inputs.card}".`);
const row = db.rows[at];
const next = await zeff.call("learn-ext", "review", { reps: row[col("Reps")], lapses: row[col("Lapses")], ease: row[col("Ease")], interval: row[col("Interval")], grade: inputs.grade, today: inputs.today });
await zeff.updateRow(CARDS, db.ids[at], { Reps: next.reps, Lapses: next.lapses, Ease: next.ease, Interval: next.interval, Due: next.due, Last: next.last });
const earned = { again: 1, hard: 3, good: 5, easy: 6 }[inputs.grade];
const award = await zeff.call("learn-ext", "award", { course: inputs.course, xp: earned, why: "review", today: inputs.today });
return { card: row[0], due: next.due, interval: next.interval, ease: next.ease, gained: earned, level: award.level };
