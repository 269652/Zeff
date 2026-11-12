// A course removed with everything of it: its steps, exercises (and their tries), cards and conversations go to the trash, its study times from the calendar.
// inputs: { course: title | id }
const COURSES = "@learn-ext.i2";
const STEPS = "@learn-ext.i3";
const gone = { steps: 0, cards: 0, exercises: 0, conversations: 0, tries: 0 };
const courses = await zeff.database(COURSES);
const want = String(inputs.course).split(",")[0].trim().replace(/^#/, "").toLowerCase();
const at = courses.rows.findIndex((r, i) => String(courses.ids[i]) === want || String(r[0]).trim().toLowerCase() === want);
if (at < 0) throw new Error(`There is no course "${inputs.course}".`);
const title = String(courses.rows[at][0]);
const steps = await zeff.database(STEPS);
const mine = steps.rows.map((r, i) => ({ r, id: steps.ids[i] })).filter(({ r }) => { const c = String(r[steps.cols.indexOf("Course")] || "").split(",")[0].trim(); return c.replace(/^#/, "") === String(courses.ids[at]) || c.toLowerCase() === title.toLowerCase(); });
const titles = new Set(mine.map(({ r }) => String(r[0])));
for (const [db, field, key] of [["@learn-ext.i4", "Step", "cards"], ["@learn-ext.i10", "Step", "exercises"], ["@learn-ext.i9", "Step", "conversations"], ["@learn-ext.i20", "Step", "tries"]]) {
  const d = await zeff.database(db);
  for (let i = 0; i < d.rows.length; i++) if (titles.has(String(d.rows[i][d.cols.indexOf(field)]))) { await zeff.deleteRow(db, d.ids[i]); gone[key]++; }
}
for (const { id } of mine) { await zeff.deleteRow(STEPS, id); gone.steps++; }
await zeff.deleteRow(COURSES, courses.ids[at]);
await zeff.call("learn-ext", "studytimes", {});
return { course: title, removed: gone };
