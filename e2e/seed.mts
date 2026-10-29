/**
 * What the e2e smoke tests need in a test server's database, made with the app's own functions (run by
 * scripts/test-server.mjs --seed e2e/seed.mts, or by e2e/run.mjs against a running test server): a person, and a database
 * with a number and a checkbox column and two rows. What was made goes to e2e-seed.json beside the database.
 */
import fs from "node:fs";
import path from "node:path";

const dbPath = process.env.DATABASE_PATH;
if (!dbPath || !process.env.ZEFF_TEST_SERVER) throw new Error("Only for a test server's database (DATABASE_PATH + ZEFF_TEST_SERVER).");
const out = path.join(path.dirname(dbPath), "e2e-seed.json");

if (!fs.existsSync(out)) {
  const { createPerson } = await import("@/plugins/people/store");
  const { createPage, addRow } = await import("@/plugins/workspace/store");
  const { newProperty, newView } = await import("@/plugins/workspace/model");

  const personName = "Erika Mustermann";
  const personId = createPerson({ name: personName });
  const dose = newProperty("Dosis", "number");
  const taken = newProperty("Genommen", "checkbox");
  const dbTitle = "E2E Medikamente";
  const dbId = createPage({ kind: "database", title: dbTitle, schema: { titleName: "Name", properties: [dose, taken], views: [newView("Table", "table")] } });
  const rows = [addRow(dbId, { title: "Alpha", cells: { [dose.id]: 10 } }), addRow(dbId, { title: "Beta", cells: { [dose.id]: 20 } })];
  // Todos about the person (the person widgets tick and dismiss them).
  (await import("@/plugins/state")).setInstalled("todos", true);
  const { addManualTodo } = await import("@/lib/boards/store");
  const todos = [`${personName} anrufen`, `${personName} das Buch zurückgeben`].map((text) => addManualTodo({ ticket: "", text }).text);
  // A page with the person's todos widget and a checklist of the page that feeds the engine (its item a todo about them).
  const mergeItem = `${personName} wegen Hamburg fragen`;
  const mergePage = createPage({
    title: "E2E Merge",
    content: {
      type: "doc",
      content: [
        { type: "zeffWidget", attrs: { widget: "people.todos", config: JSON.stringify({ person: personName }), title: "", header: "" } },
        { type: "taskList", attrs: { listId: "te2e", title: "", engine: true }, content: [{ type: "taskItem", attrs: { checked: false, itemId: "ie2e1" }, content: [{ type: "paragraph", content: [{ type: "text", text: mergeItem }] }] }] },
        { type: "paragraph", content: [{ type: "text", text: "Ende" }] },
      ],
    },
  });
  (await import("@/plugins/workspace/task-lists")).syncPageLists(mergePage);
  fs.writeFileSync(out, JSON.stringify({ personId, personName, dbId, dbTitle, rows, rowTitles: ["Alpha", "Beta"], props: { dose: dose.id, taken: taken.id }, todos, mergePage, mergeItem }, null, 2));
}
// Today (e2e/heute.e2e.mjs): two of your todos due today — one to tick, one to dismiss (added to a seed made before, once).
const seed = JSON.parse(fs.readFileSync(out, "utf8"));
if (!seed.heuteTodos) {
  (await import("@/plugins/state")).setInstalled("todos", true);
  const { addManualTodo, setTodoDue } = await import("@/lib/boards/store");
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  seed.heuteTodos = ["E2E Heute: Steuer abgeben", "E2E Heute: Keller aufräumen"].map((text) => {
    const todo = addManualTodo({ ticket: "", text });
    setTodoDue(todo.id, today);
    return todo.text;
  });
  fs.writeFileSync(out, JSON.stringify(seed, null, 2));
}
console.log(`e2e seed: ${out}`);
