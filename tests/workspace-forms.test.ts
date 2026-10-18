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

test("repeating rows: days, weekdays every N weeks and the day of the month are worked out; a due rule makes one row, filled from its template", async () => {
  (await import("@/plugins/state")).setInstalled("workspace", true);
  const store = await import("@/plugins/workspace/store");
  const { applyOps } = await import("@/plugins/workspace/schema-ops");
  const { occursOn, nextDue, saveRecurrence, runDueRecurrences, recurrences } = await import("@/plugins/workspace/recurring");
  const D = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min);
  // Mondays and Thursdays every 2nd week, counted from Monday 5 Oct 2026.
  const biweekly = { unit: "week" as const, interval: 2, weekdays: [1, 4], start: "2026-10-05" };
  assert.equal(occursOn(biweekly, D(2026, 10, 5)), true);
  assert.equal(occursOn(biweekly, D(2026, 10, 8)), true);
  assert.equal(occursOn(biweekly, D(2026, 10, 12)), false, "the week between");
  assert.equal(occursOn(biweekly, D(2026, 10, 19)), true);
  assert.equal(occursOn(biweekly, D(2026, 10, 4)), false, "before the start");
  const monthly = { unit: "month" as const, interval: 1, start: "2026-01-31" };
  assert.equal(occursOn(monthly, D(2026, 2, 28)), true, "the 31st falls on the last day of a short month");
  assert.equal(occursOn(monthly, D(2026, 3, 31)), true);
  assert.equal(occursOn({ unit: "day", interval: 3, start: "2026-10-01" }, D(2026, 10, 7)), true);

  const db = store.createPage({ kind: "database", title: "Chores" });
  const { schema } = applyOps(store.getDatabase(db)!.schema, [{ op: "add_property", name: "Due", type: "date" }, { op: "add_property", name: "Note", type: "text" }], { related: () => null });
  const saved = store.saveSchema(db, schema);
  const due = saved.properties.find((p) => p.name === "Due")!;
  const note = saved.properties.find((p) => p.name === "Note")!;
  const tpl = store.addRow(db, { title: "Water the plants", cells: { [note.id]: "Week {{week}}" } });
  store.updatePage(tpl, { template: true });
  assert.deepEqual(store.templateParams(tpl), [], "a built-in placeholder is not asked for");
  const now = D(2026, 10, 19, 7, 0);
  const rule = saveRecurrence({ db, templateId: tpl, unit: "day", interval: 1, at: "08:00", start: "2026-10-19", dateProp: due.id }, now);
  assert.equal(new Date(rule.nextAt).getTime(), D(2026, 10, 19, 8, 0).getTime(), "today at eight, its time still ahead");
  assert.equal(runDueRecurrences(D(2026, 10, 19, 7, 30)), 0, "not yet");
  const before = store.rowsOf(db)!.rows.length;
  assert.equal(runDueRecurrences(D(2026, 10, 21, 9, 0)), 1, "two days missed: one row, not three");
  const rows = store.rowsOf(db)!.rows;
  assert.equal(rows.length, before + 1);
  const made = rows.find((r) => r.id === recurrences(db)[0].lastRow)!;
  assert.equal(made.title, "Water the plants");
  assert.match(String(made.cells[note.id]), /^Week \d+$/, "the built-in {{week}} is filled");
  assert.equal(made.cells[due.id], "2026-10-19", "the day it was due");
  assert.equal(new Date(recurrences(db)[0].nextAt).getTime(), D(2026, 10, 22, 8, 0).getTime());
  assert.equal(nextDue(rule, D(2026, 10, 21, 9, 0))!.getDate(), 22);
});

test("protection: unique values, a locked database, and what the AI may do - the store holds to it for every caller", async () => {
  (await import("@/plugins/state")).setInstalled("workspace", true);
  const store = await import("@/plugins/workspace/store");
  const { agentScope } = await import("@/plugins/workspace/agent-scope");
  const { viaSource } = await import("@/plugins/workspace/events");
  const { applyOps } = await import("@/plugins/workspace/schema-ops");
  const id = store.createPage({ kind: "database", title: "Customers" });
  const { schema } = applyOps(store.getDatabase(id)!.schema, [{ op: "add_property", name: "Email", type: "email" }], { related: () => null });
  const saved = store.saveSchema(id, schema);
  const email = saved.properties.find((p) => p.name === "Email")!;
  store.saveSchema(id, { ...saved, protect: { unique: ["title", email.id] } });
  assert.deepEqual(store.getDatabase(id)!.schema.protect, { unique: ["title", email.id] }, "kept with the schema");
  const a = store.addRow(id, { title: "Ann", cells: { [email.id]: "ann@x.io" } });
  assert.throws(() => store.addRow(id, { title: "ann" }), /title" must be unique/, "the title, without case");
  assert.throws(() => store.addRow(id, { title: "Bob", cells: { [email.id]: "ANN@x.io" } }), /Email" must be unique/);
  const b = store.addRow(id, { title: "Bob" });
  assert.throws(() => store.setCell(b, email.id, "ann@x.io"), /must be unique/);
  assert.throws(() => store.updatePage(b, { title: "Ann" }), /must be unique/);
  store.setCell(b, email.id, "bob@x.io");
  store.setCell(a, email.id, "ann@x.io"); // (its own value again: no clash)
  store.addRow(id, { title: "" });
  store.addRow(id, { title: "" }); // (empty values never clash)

  store.saveSchema(id, { ...store.getDatabase(id)!.schema, protect: { ai: "append" } });
  agentScope.run(true, () => {
    store.addRow(id, { title: "By the AI" });
    assert.throws(() => store.setCell(b, email.id, "x@y.z"), /only add rows/);
    assert.throws(() => store.archivePage(b), /only add rows/);
  });
  store.setCell(b, email.id, "you@x.io"); // (you may)
  store.saveSchema(id, { ...store.getDatabase(id)!.schema, protect: { ai: "read" } });
  agentScope.run(true, () => assert.throws(() => store.addRow(id, { title: "no" }), /may not change/));

  store.saveSchema(id, { ...store.getDatabase(id)!.schema, protect: { lock: true } });
  assert.throws(() => store.addRow(id, { title: "locked" }), /locked/);
  assert.throws(() => store.setCell(b, email.id, "z@z.zz"), /locked/);
  assert.throws(() => store.archivePage(b), /locked/);
  viaSource(() => store.addRow(id, { title: "From the source" })); // (a source still writes its records)
  const { loadDatabaseAction } = await import("@/plugins/workspace/actions");
  const loaded = await loadDatabaseAction(id);
  assert.equal(loaded.ok && loaded.data.locked, true, "the page shows it as locked");
});

test("field types: the Workspace's rating and progress, and a type a plugin brings - entries are checked by the type, shown by its display", async () => {
  (await import("@/plugins/state")).setInstalled("workspace", true);
  await import("@/plugins/contributions");
  const store = await import("@/plugins/workspace/store");
  const { workspaceFieldTypes } = await import("@/plugins/workspace/field-point");
  const { fieldTypeInfos } = await import("@/plugins/workspace/field-types");
  const { loadDatabaseAction } = await import("@/plugins/workspace/actions");
  workspaceFieldTypes.contribute("core", [
    { id: "core.ticket", label: "Ticket", icon: "🎫", description: "A ticket key", display: "link", href: "https://jira.example/browse/{value}", suggestions: () => ["ABC-1", "ABC-2"], parse: (s) => { if (!s) return null; if (!/^[A-Z]+-\d+$/i.test(s)) throw new Error("not a key"); return s.toUpperCase(); } },
  ]);
  const ids = fieldTypeInfos().map((f) => f.id);
  assert.ok(["workspace.rating", "workspace.progress", "core.ticket"].every((x) => ids.includes(x)));
  const id = store.createPage({ kind: "database", title: "Typed" });
  const cur = store.getDatabase(id)!.schema;
  const mk = (name: string, custom: string) => ({ id: `p_${name}`, name, type: "custom" as const, custom });
  store.saveSchema(id, { ...cur, properties: [...cur.properties, mk("Stars", "workspace.rating"), mk("Done", "workspace.progress"), mk("Key", "core.ticket"), mk("Gone", "nobody.nothing")] });
  const row = store.addRow(id, { title: "R", cells: { p_Stars: "4", p_Done: 150, p_Key: "abc-12", p_Gone: "free text" } });
  const cells = () => store.rowsOf(id)!.rows.find((r) => r.id === row)!.cells;
  assert.equal(cells().p_Stars, 4);
  assert.equal(cells().p_Done, undefined, "150 is no percentage: dropped");
  assert.equal(cells().p_Key, "ABC-12", "put into shape by the type");
  assert.equal(cells().p_Gone, "free text", "a type that is gone keeps the text");
  store.setCell(row, "p_Stars", 9);
  assert.equal(cells().p_Stars, undefined, "9 stars: refused, the cell is cleared like any entry that does not fit");
  store.setCell(row, "p_Done", "75");
  assert.equal(cells().p_Done, 75);
  store.setCell(row, "p_Key", "nonsense");
  assert.equal(cells().p_Key, undefined);
  const loaded = await loadDatabaseAction(id);
  assert.ok(loaded.ok && loaded.data.extras.fieldTypes?.some((f) => f.id === "core.ticket" && f.suggestions.length === 2 && f.display === "link"));
  assert.equal(loaded.ok && loaded.data.schema.properties.find((p) => p.name === "Key")!.custom, "core.ticket", "the type stays in the property");
});
