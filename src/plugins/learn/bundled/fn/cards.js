// Cards for a lesson: the things worth remembering, coming back for review when the person is about to forget them.
// inputs: { step: id or title, cards: [{ front, back }], today?: "YYYY-MM-DD" }
const STEPS = "@learn-ext.i3";
const CARDS = "@learn-ext.i4";
const today = inputs.today || new Date().toISOString().slice(0, 10);
const steps = await zeff.database(STEPS);
const want = String(inputs.step).trim().replace(/^#/, "").toLowerCase();
const at = steps.rows.findIndex((r, i) => String(steps.ids[i]) === want || String(r[0]).trim().toLowerCase() === want);
if (at < 0) throw new Error(`There is no step "${inputs.step}".`);
const title = String(steps.rows[at][0]);
let made = 0;
for (const c of (Array.isArray(inputs.cards) ? inputs.cards : []).slice(0, 12)) {
  if (!c || !c.front || !c.back) continue;
  await zeff.addRow(CARDS, { Front: String(c.front).slice(0, 200), Back: String(c.back).slice(0, 800), Step: title, Reps: 0, Lapses: 0, Ease: 2.5, Interval: 0, Due: today });
  made++;
}
return { step: title, cards: made };
