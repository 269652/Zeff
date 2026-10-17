import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

test("a form: asks the listed fields, required ones must be filled, hidden ones are prefilled, a choice by id or name", async () => {
  (await import("@/plugins/state")).setInstalled("workspace", true);
  const store = await import("@/plugins/workspace/store");
  const { applyOps } = await import("@/plugins/workspace/schema-ops");
  const { formFor, submitForm } = await import("@/plugins/workspace/form");
  const id = store.createPage({ kind: "database", title: "Requests" });
  const { schema } = applyOps(store.getDatabase(id)!.schema, [{ op: "add_property", name: "Email", type: "email" }, { op: "add_property", name: "Urgent", type: "checkbox" }, { op: "add_property", name: "Topic", type: "multi_select", options: ["Billing", "Bug"] }], { related: () => null });
  const saved = store.saveSchema(id, schema);
  const p = (n: string) => saved.properties.find((x) => x.name === n)!;
  assert.equal(formFor(id), null, "off until it is switched on");
  store.saveSchema(id, { ...saved, form: { enabled: true, title: "Ask us", intro: "", thanks: "Thanks!", titleLabel: "Subject", titleRequired: true, fields: [{ prop: p("Email").id, required: true }, { prop: p("Topic").id }, { prop: p("Urgent").id }, { prop: p("Status").id, hidden: true, default: "In progress" }, { prop: "nope" }] } });
  const form = formFor(id)!;
  assert.equal(form.fields.length, 4, "a field that is not a property is dropped");
  assert.throws(() => submitForm(id, "", { [p("Email").id]: "a@b.c" }), /Subject/);
  assert.throws(() => submitForm(id, "Hello", {}), /Email/);
  const row = submitForm(id, "Hello", { [p("Email").id]: "a@b.c", [p("Topic").id]: ["Bug"], [p("Urgent").id]: true });
  const cells = store.rowsOf(id)!.rows.find((r) => r.id === row)!.cells;
  assert.equal(cells[p("Email").id], "a@b.c");
  assert.deepEqual(cells[p("Topic").id], [p("Topic").options![1].id]);
  assert.equal(cells[p("Urgent").id], true);
  assert.equal(cells[p("Status").id], p("Status").options!.find((o) => o.name === "In progress")!.id, "the hidden field's prefilled value (by name)");
});

test("rows moved to another database take what has a counterpart, a choice by the name of its option; the old rows go to the trash", async () => {
  const store = await import("@/plugins/workspace/store");
  const { applyOps } = await import("@/plugins/workspace/schema-ops");
  const { valuesToCells } = await import("@/plugins/workspace/mcp-db");
  const a = store.createPage({ kind: "database", title: "Inbox A" });
  const b = store.createPage({ kind: "database", title: "Archive B" });
  const sa = applyOps(store.getDatabase(a)!.schema, [{ op: "add_property", name: "Owner", type: "text" }, { op: "add_property", name: "Only here", type: "text" }], { related: () => null }).schema;
  store.saveSchema(a, sa);
  const sb = applyOps(store.getDatabase(b)!.schema, [{ op: "add_property", name: "Owner", type: "text" }], { related: () => null }).schema;
  store.saveSchema(b, sb);
  const c = await valuesToCells(store.getDatabase(a)!.schema, { Owner: "Ann", "Only here": "x", Status: "In progress" });
  store.updateSchema(a, c.schema);
  const row = store.addRow(a, { title: "Move me", cells: c.cells });
  const r = store.moveRowsToDatabase([row], b);
  assert.equal(r.moved.length, 1);
  assert.deepEqual(r.dropped, ["Only here"]);
  const moved = store.rowsOf(b)!.rows.find((x) => x.id === r.moved[0])!;
  assert.equal(moved.title, "Move me");
  assert.equal(moved.cells[store.getDatabase(b)!.schema.properties.find((p) => p.name === "Owner")!.id], "Ann");
  assert.equal(store.getPage(row)!.archivedAt !== null, true, "the old row is in the trash");
  const status = store.getDatabase(b)!.schema.properties.find((p) => p.name === "Status")!;
  assert.equal(moved.cells[status.id], status.options!.find((o) => o.name === "In progress")!.id, "a choice by the name of its option");
});

test("the favorites keep the order they were put in", async () => {
  const store = await import("@/plugins/workspace/store");
  const x = store.createPage({ title: "Alpha" });
  const y = store.createPage({ title: "Beta" });
  const z = store.createPage({ title: "Gamma" });
  for (const id of [x, y, z]) store.updatePage(id, { favorite: true });
  assert.deepEqual(store.favorites().map((f) => f.title), ["Alpha", "Beta", "Gamma"], "by title until placed");
  store.setFavoriteOrder([z, x, y]);
  assert.deepEqual(store.favorites().map((f) => f.title), ["Gamma", "Alpha", "Beta"]);
  const w = store.createPage({ title: "Aardvark" });
  store.updatePage(w, { favorite: true });
  assert.equal(store.favorites().at(-1)!.title, "Aardvark", "a new favorite comes last");
});

test("automations and their runs are rows; the box On switches a routine", async () => {
  (await import("@/plugins/state")).setInstalled("workspace", true);
  const store = await import("@/plugins/workspace/store");
  const routines = await import("@/plugins/workspace/routines");
  await import("@/plugins/contributions");
  const { ensureAutomationDatabases } = await import("@/plugins/workspace/automation-databases");
  const { getPref } = await import("@/lib/prefs");
  const { runPipeline } = await import("@/plugins/workspace/pipeline");
  const page = store.createPage({ title: "Weekly digest" });
  routines.createRoutine(page, "automation", { enabled: true, triggers: [{ kind: "schedule", everyMinutes: 60 }] });
  const run = routines.startRun(page, { kind: "manual" });
  routines.finishRun(run, { status: "done", log: [{ step: "Make the list", kind: "set", status: "ok", note: "3 rows" }] });
  await ensureAutomationDatabases();
  const autos = getPref<number>("workspace.automationsDb", 0);
  const runs = getPref<number>("workspace.automationRunsDb", 0);
  assert.ok(autos && runs, "both databases are made");
  await runPipeline(autos, { ai: false });
  await runPipeline(runs, { ai: false });
  const arow = store.rowsOf(autos)!.rows.find((r) => r.title === "Weekly digest")!;
  assert.equal(arow.cells.autoon, true);
  assert.match(String(arow.cells.autowhen), /60/);
  assert.equal(arow.cells.autostatus, "done");
  const rrow = store.rowsOf(runs)!.rows.find((r) => r.title.startsWith("Weekly digest"))!;
  assert.equal(rrow.cells.runstatus, "done");
  assert.match(store.getPage(rrow.id)!.content.content?.[0] ? JSON.stringify(store.getPage(rrow.id)!.content) : "", /Make the list/);
  // The box ticked off in the row: the routine is off.
  store.setCell(arow.id, "autoon", false);
  await runPipeline(autos, { ai: false });
  assert.equal(routines.getRoutine(page)!.enabled, false);
  // A read-only source: no row can be made by hand, the page is told so.
  const { addRowAction, loadDatabaseAction } = await import("@/plugins/workspace/actions");
  const refused = await addRowAction(autos, { title: "mine" });
  assert.equal(refused.ok, false);
  assert.equal(store.rowsOf(autos)!.rows.some((r) => r.title === "mine"), false);
  const loaded = await loadDatabaseAction(autos);
  assert.equal(loaded.ok && loaded.data.noNewRows, true);
});

test("a row template with {{placeholders}}: they are found, and filled in title, cells and page when a row is made from it", async () => {
  const store = await import("@/plugins/workspace/store");
  const { markdownToDoc, docText } = await import("@/plugins/workspace/doc");
  const { newProperty } = await import("@/plugins/workspace/model");
  const id = store.createPage({ kind: "database", title: "Meetings", schema: { titleName: "Name", properties: [{ ...newProperty("Where", "text") }], views: [] } });
  const where = store.getDatabase(id)!.schema.properties[0].id;
  const tpl = store.createPage({ dbId: id, title: "Meeting: {{Topic}}", template: true, content: markdownToDoc("Agenda for {{Topic}} with {{ Person }}.\n\n- Open points of {{Person}}"), props: { [where]: "Room of {{Person}}" } });
  assert.deepEqual(store.templateParams(tpl), ["Topic", "Person"]);
  const row = store.addRow(id, { templateId: tpl, params: { Topic: "Budget", Person: "Ann" } });
  const page = store.getPage(row)!;
  assert.equal(page.title, "Meeting: Budget");
  assert.equal(page.props[where], "Room of Ann");
  assert.match(docText(page.content), /Agenda for Budget with Ann\./);
  assert.match(docText(page.content), /Open points of Ann/);
  const plain = store.addRow(id, { templateId: tpl });
  assert.equal(store.getPage(plain)!.title, "Meeting: {{Topic}}", "without values the placeholders stay");
});

test("a page as a read-only HTML file: text, lists, tables, callouts - nothing runs, nothing of Zeff is in it", async () => {
  const store = await import("@/plugins/workspace/store");
  const { markdownToDoc } = await import("@/plugins/workspace/doc");
  const { pageToHtml } = await import("@/plugins/workspace/export-html");
  const md = '# Plan\n\nSome **bold** text, [a link](https://example.org) and [bad](javascript:alert(1)) and <script>alert(1)</script>.\n\n- [x] done\n- [ ] open\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n:::callout 🚀 blue\nNote\n:::\n\n:::block metric {"dbId":1}\n';
  const id = store.createPage({ title: "Plan <b>x</b>", icon: "🗓", content: markdownToDoc(md) });
  const { filename, html } = pageToHtml(id);
  assert.match(filename, /^Plan_b_x_b_\.html$|^Plan.*\.html$/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /href="https:\/\/example\.org"/);
  assert.doesNotMatch(html, /javascript:/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /☑/);
  assert.match(html, /<table>/);
  assert.match(html, /class="callout"/);
  assert.doesNotMatch(html, /metric|dbId/, "a data block is not part of the file");
  assert.match(html, /<title>Plan &lt;b&gt;x&lt;\/b&gt;<\/title>/);
  // A database as its table.
  const db = store.createPage({ kind: "database", title: "Things" });
  store.addRow(db, { title: "One & <two>" });
  assert.match(pageToHtml(db).html, /One &amp; &lt;two&gt;/);
});

test("quick capture: a note becomes a row of the database Capture (first line the title), nothing empty is accepted", async () => {
  (await import("@/plugins/state")).setInstalled("workspace", true);
  const store = await import("@/plugins/workspace/store");
  const { capture, captureDatabase } = await import("@/plugins/workspace/capture");
  await assert.rejects(() => capture("   ", []), /Write something/);
  const r = await capture("Call the plumber\nabout the tap", [], "phone");
  const db = captureDatabase()!;
  assert.ok(db);
  const row = store.rowsOf(db)!.rows.find((x) => x.id === r.id)!;
  assert.equal(row.title, "Call the plumber");
  assert.equal(row.cells.capfrom, "phone");
  assert.equal((await capture("again", [])).id !== r.id, true);
  assert.equal(captureDatabase(), db, "one database, not one per capture");
});

test("the write gate: no row by hand in a database that only shows a source - the source itself still writes", async () => {
  const store = await import("@/plugins/workspace/store");
  const { getPref } = await import("@/lib/prefs");
  const { runPipeline } = await import("@/plugins/workspace/pipeline");
  const autos = getPref<number>("workspace.automationsDb", 0);
  assert.ok(autos);
  assert.equal(store.rowsAddable(autos), false);
  assert.throws(() => store.addRow(autos, { title: "by hand" }), /only shows records/);
  const before = store.rowsOf(autos)!.rows.length;
  await runPipeline(autos, { ai: false, force: true });
  assert.equal(store.rowsOf(autos)!.rows.length, before, "the source's own run still works");
  const free = store.createPage({ kind: "database", title: "Free" });
  assert.equal(store.rowsAddable(free), true);
});

test("history: a changed cell is put back from the activity line; what the log can't hold whole is refused", async () => {
  (await import("@/plugins/state")).setInstalled("workspace", true);
  const store = await import("@/plugins/workspace/store");
  const { applyOps } = await import("@/plugins/workspace/schema-ops");
  const { activityOf, restoreChange } = await import("@/plugins/workspace/activity");
  const id = store.createPage({ kind: "database", title: "History" });
  const { schema } = applyOps(store.getDatabase(id)!.schema, [{ op: "add_property", name: "Note", type: "text" }, { op: "add_property", name: "Done", type: "checkbox" }, { op: "add_property", name: "Size", type: "number" }, { op: "add_property", name: "Kind", type: "select", options: ["A", "B"] }], { related: () => null });
  const saved = store.saveSchema(id, schema);
  const p = (n: string) => saved.properties.find((x) => x.name === n)!;
  const row = store.addRow(id, { title: "R" });
  const cell = (n: string) => store.rowsOf(id)!.rows.find((r) => r.id === row)!.cells[p(n).id];
  const undo = async (field: string) => restoreChange(activityOf(row).find((l) => l.field === field)!.id);
  store.setCell(row, p("Note").id, "first");
  store.setCell(row, p("Note").id, "second");
  await undo("Note");
  assert.equal(cell("Note"), "first");
  store.setCell(row, p("Done").id, true);
  await undo("Done");
  assert.notEqual(cell("Done"), true);
  store.setCell(row, p("Size").id, 5);
  store.setCell(row, p("Size").id, 7);
  await undo("Size");
  assert.equal(cell("Size"), 5);
  const choice = (n: string) => p("Kind").options!.find((o) => o.name === n)!.id;
  store.setCell(row, p("Kind").id, choice("A"));
  store.setCell(row, p("Kind").id, choice("B"));
  await undo("Kind");
  assert.equal(cell("Kind"), p("Kind").options!.find((o) => o.name === "A")!.id);
  store.setCell(row, p("Note").id, "x".repeat(300));
  store.setCell(row, p("Note").id, "short");
  await assert.rejects(() => undo("Note"), /too long/);
  store.updatePage(row, { title: "Renamed" });
  await undo("title");
  assert.equal(store.getPage(row)!.title, "R");
});
