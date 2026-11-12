// The courses as cards: level, streak, cards due and how far each plan is. inputs: {}
// (Three reads of the databases and no more: every call into Zeff costs a round trip, and this is the first thing the app shows.)
const COURSES = "@learn-ext.i2";
const STEPS = "@learn-ext.i3";
const CARDS = "@learn-ext.i4";
const today = new Date().toISOString().slice(0, 10);
const clean = (s) => String(s ?? "").split(",")[0].trim().replace(/^#/, "").toLowerCase();
const [courses, steps, cards] = await Promise.all([zeff.database(COURSES), zeff.database(STEPS), zeff.database(CARDS)]);
const cc = (n) => courses.cols.indexOf(n);
const sc = (n) => steps.cols.indexOf(n);
const kc = (n) => cards.cols.indexOf(n);
const yes = (v) => v === true || v === "Yes" || v === "yes" || v === "true";
const out = [];
let dueAll = 0;
courses.rows.forEach((r, i) => {
  const status = String(r[cc("Status")] || "ready");
  const mine = new Set([String(courses.ids[i]), String(r[0]).trim().toLowerCase()]);
  const own = steps.rows.filter((s) => mine.has(clean(s[sc("Course")])));
  const parents = new Set(own.map((s) => String(s[sc("Parent")] || "")).filter(Boolean));
  const leaves = own.filter((s) => !parents.has(String(s[sc("Key")] || "")));
  const done = leaves.filter((s) => yes(s[sc("Mastered")])).length;
  const titles = new Set(own.map((s) => String(s[0])));
  const due = status === "ready" ? cards.rows.filter((c) => titles.has(String(c[kc("Step")])) && String(c[kc("Due")] || "0") <= today).length : 0;
  dueAll += due;
  out.push({ title: String(r[0]), status, space: String(r[cc("Space")] || ""), level: Number(r[cc("Level")]) || 1, streak: Number(r[cc("Streak")]) || 0, due, steps: status === "ready" ? leaves.length : 0, mastered: done, percent: status === "ready" && leaves.length ? Math.round((done / leaves.length) * 100) : 0 });
});
const spaces = [...new Set(out.map((c) => c.space).filter(Boolean))];
return { courses: out, due: dueAll, spaces, spaceOptions: spaces.join(", ") };
