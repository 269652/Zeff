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
  // A new person's page (a row of a people database, never opened): it starts with the default layout when first opened.
  const newPerson = createPerson({ name: "Nina Neumann" });
  const peopleDb = createPage({ kind: "database", title: "E2E People", schema: { titleName: "Name", properties: [], views: [newView("Table", "table")], dataType: "people" } });
  const newPersonRow = addRow(peopleDb, { title: "Nina Neumann" });
  (await import("@/db")).getSqlite().prepare("update ws_pages set props = ? where id = ?").run(JSON.stringify({ srcref: `person:${newPerson}` }), newPersonRow);
  fs.writeFileSync(out, JSON.stringify({ personId, personName, dbId, dbTitle, rows, rowTitles: ["Alpha", "Beta"], props: { dose: dose.id, taken: taken.id }, todos, mergePage, mergeItem, newPersonRow }, null, 2));
}
// Today (e2e/heute.e2e.mjs): two of your todos due today — one to tick, one to dismiss (added to a seed made before, once).
{
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
}

// Think along, the embedded calendar, Kennzahlen (added to a seed made before, too).
{
const seed = JSON.parse(fs.readFileSync(out, "utf8"));
if (!seed.assistPage) {
  const { createPage } = await import("@/plugins/workspace/store");
  const { setInstalled } = await import("@/plugins/state");
  // The AI: Claude (the test server's --fake-ai makes its CLI the fake one, answering what the test writes).
  for (const id of ["llm", "claude-cli", "calendar", "todos"]) setInstalled(id, true);
  (await import("@/lib/ai")).updateAppSettings({ aiProvider: "claude" });
  const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
  const assistText = "Besuch in Hamburg im März 2027 planen.";
  const assistPage = createPage({ title: "E2E Mitdenken", content: { type: "doc", content: [paragraph(assistText), paragraph("Ende")] } });
  // A plan calendar with an all-day event, shown in a page (its week).
  const ir = await import("@/lib/calendar/ir");
  const cal = ir.createShadowCalendar("E2E Plan");
  const calEvent = "E2E Ausflug";
  ir.addEvent(cal.id, { title: calEvent, start: "2027-03-03", end: "2027-03-04", allDay: true });
  const calendarPage = createPage({
    title: "E2E Kalender",
    content: { type: "doc", content: [{ type: "calendarEmbed", attrs: { calendarId: cal.id, view: "week", day: "2027-03-01", also: "" } }, paragraph("Ende")] },
  });
  // Two Kennzahlen from formulas.
  const { defineFormulaMetric } = await import("@/plugins/workspace/metrics");
  const metrics = [
    { label: "E2E Puffer", formula: "40+2", shown: "42" },
    { label: "E2E Quote", formula: "3*5", shown: "15" },
  ];
  for (const m of metrics) defineFormulaMetric({ label: m.label, formula: m.formula });
  Object.assign(seed, { assistPage, assistText, calendarPage, calendarId: cal.id, calEvent, calEventDay: "2027-03-03", metrics });
  fs.writeFileSync(out, JSON.stringify(seed, null, 2));
}
}

// Forms from a table: a board (by its status) with a date and a person, no entry form yet — and a form of it whose person field
// has the seeded person as its default (the designer shows the name).
{
  const seed = JSON.parse(fs.readFileSync(out, "utf8"));
  if (!seed.boardDb) {
    const { createPage } = await import("@/plugins/workspace/store");
    const { newProperty, newView } = await import("@/plugins/workspace/model");
    const { createForm } = await import("@/plugins/workspace/forms");
    const { fieldItem, newStep } = await import("@/plugins/workspace/form-spec");
    const status = { ...newProperty("Status", "status"), options: [{ id: "e2eOpen", name: "Offen", color: "gray" }, { id: "e2eDone", name: "Erledigt", color: "green" }] };
    const due = newProperty("Fällig", "date");
    const who = newProperty("Wer", "person");
    const boardTitle = "E2E Aufgabenboard";
    const boardDb = createPage({ kind: "database", title: boardTitle, schema: { titleName: "Aufgabe", properties: [status, due, who], views: [{ ...newView("Board", "board"), groupBy: status.id }] } });
    const personForm = createForm({ dbId: boardDb, title: "E2E Personenformular", def: { dbId: boardDb, title: "", intro: "", submitLabel: "", thanks: "", steps: [{ ...newStep(), items: [fieldItem("title", { required: true }), fieldItem(who.id, { default: String(seed.personId) })] }] } });
    fs.writeFileSync(out, JSON.stringify({ ...seed, boardDb, boardTitle, boardProps: { status: status.id, due: due.id, who: who.id }, personForm }, null, 2));
  }
}

// Templates: one of your own (a page marked a template, with a line of text) — in the Templates of the tree, not among the pages.
{
  const seed = JSON.parse(fs.readFileSync(out, "utf8"));
  if (!seed.ownTemplate) {
    const { createPage } = await import("@/plugins/workspace/store");
    const ownTemplateTitle = "E2E Eigene Vorlage";
    const ownTemplate = createPage({ title: ownTemplateTitle, icon: "🧪", template: true, content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Aus der eigenen Vorlage" }] }] } });
    fs.writeFileSync(out, JSON.stringify({ ...seed, ownTemplate, ownTemplateTitle }, null, 2));
  }
}
console.log(`e2e seed: ${out}`);
