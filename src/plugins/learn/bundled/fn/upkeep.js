// The upkeep Learn does by itself every hour: what was ticked mastered in the database gets its experience and completes its skills (not only when the
// app is opened); a todo "review N cards" is on the list while cards are due; the study times in the calendar are kept four weeks ahead.
// inputs: {}  (run by the plugin's schedule)
const COURSES = "@learn-ext.i2";
const CARDS = "@learn-ext.i4";
const STEPS = "@learn-ext.i3";
const today = new Date().toISOString().slice(0, 10);
const yes = (v) => v === true || v === "Yes" || v === "yes" || v === "true";
// (Read once: what each course needs of them doesn't change while the others are looked at.)
const [courses, steps, cards] = await Promise.all([zeff.database(COURSES), zeff.database(STEPS), zeff.database(CARDS)]);
const stepAt = new Map(steps.ids.map((id, i) => [id, i]));
const awarded = (rowId) => yes(steps.rows[stepAt.get(rowId)]?.[steps.cols.indexOf("Awarded")]);
const due = cards.rows.filter((r) => String(r[cards.cols.indexOf("Due")] || "0") <= today).length;
let openTodos = null;
const result = { settled: 0, todos: 0 };
for (const [i, row] of courses.rows.entries()) {
  const title = String(row[0]);
  // Ticked by hand (in the database, on the phone, by a routine): the experience of every node mastered and not yet given.
  const s = await zeff.call("learn-ext", "state", { course: title });
  const owed = s.nodes.filter((n) => n.status === "mastered" && !awarded(n.row));
  if (owed.length) {
    for (const n of owed) await zeff.updateRow(STEPS, n.row, { Mastered: true, Awarded: true, MasteredAt: today });
    await zeff.call("learn-ext", "award", { course: title, xp: owed.reduce((x, n) => x + n.points, 0), why: "mastered", detail: owed.map((n) => n.title).join(", ").slice(0, 500), today });
    result.settled += owed.length;
  }
  // The review todo: one on the list while cards are due.
  const known = Number(row[courses.cols.indexOf("ReviewTodo")]) || 0;
  if (due > 0) {
    let open = false;
    if (known) open = (openTodos ??= await zeff.api("todos.list", { status: "open" })).some((t) => t.id === known);
    if (!open) {
      const t = await zeff.api("todos.add", { text: `Karten wiederholen: ${title} (${due})` });
      await zeff.updateRow(COURSES, courses.ids[i], { ReviewTodo: t.id });
      result.todos++;
    }
  }
}
await zeff.call("learn-ext", "studytimes", {});
return result;
