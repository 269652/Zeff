// A step is mastered: marked, and with it every skill, phase and year it completes (each marked, each given its experience once - what was
// mastered before is not counted again). A step whose requirements are not mastered yet cannot be; a skill, phase or year is mastered through
// its steps. Returns the experience given, what was completed and the steps that opened.
// inputs: { step: title | row id | key, course?: title, note?: text, today?: "YYYY-MM-DD" }
const STEPS = "@learn-ext.i3";
const before = await zeff.call("learn-ext", "state", { course: inputs.course });
const want = String(inputs.step).trim().replace(/^#/, "").toLowerCase();
const node = before.nodes.find((n) => String(n.row) === want || n.key.toLowerCase() === want || n.title.trim().toLowerCase() === want);
if (!node) throw new Error(`There is no step "${inputs.step}".`);
if (node.status === "mastered") return { step: node.title, gained: 0, completed: [], opened: [], already: true };
if (node.status === "locked") throw new Error(`"${node.title}" is still locked: what it requires is not mastered yet.`);
if (before.nodes.some((n) => n.parent === node.key)) throw new Error(`"${node.title}" is mastered through its steps.`);
const today = inputs.today || new Date().toISOString().slice(0, 10);
const db = await zeff.database(STEPS);
const awardedOf = (row) => { const i = db.ids.indexOf(row); const v = db.rows[i][db.cols.indexOf("Awarded")]; return v === true || v === "Yes" || v === "yes"; };
const mark = (n) => zeff.updateRow(STEPS, n.row, { Mastered: true, Awarded: true, MasteredAt: today });
await mark(node);
const after = await zeff.call("learn-ext", "state", { course: inputs.course });
const completed = after.nodes.filter((n) => n.status === "mastered" && before.nodes.find((b) => b.key === n.key)?.status !== "mastered");
for (const n of completed) if (n.key !== node.key) await mark(n);
const gained = completed.filter((n) => !awardedOf(n.row)).reduce((s, n) => s + n.points, 0);
const award = gained > 0 ? await zeff.call("learn-ext", "award", { course: before.course ? before.course.title : undefined, xp: gained, why: "mastered", today, detail: String(inputs.note || "").slice(0, 300) }) : null;
return { step: node.title, gained, completed: completed.map((n) => n.title), opened: after.next.filter((k) => !before.next.includes(k)), award };
