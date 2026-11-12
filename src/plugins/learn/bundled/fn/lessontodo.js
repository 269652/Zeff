// A todo for a lesson: "Learn: <step>" on your todo list, its number kept on the step.
// inputs: { step: id or title }   (needs the permission for Zeff's todos.add)
const STEPS = "@learn-ext.i3";
const db = await zeff.database(STEPS);
const want = String(inputs.step).trim().toLowerCase();
const at = db.rows.findIndex((r, i) => String(db.ids[i]) === want || String(r[0]).trim().toLowerCase() === want);
if (at < 0) throw new Error(`There is no step "${inputs.step}".`);
const already = Number(db.rows[at][db.cols.indexOf("LessonTodo")]) || 0;
if (already) return { todo: already, made: false };
const todo = await zeff.api("todos.add", { text: `Learn: ${db.rows[at][0]}` });
await zeff.updateRow(STEPS, db.ids[at], { LessonTodo: todo.id });
return { todo: todo.id, made: true };
