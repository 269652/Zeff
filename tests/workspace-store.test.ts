import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const doc = (text: string, extra: object[] = []) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }, ...extra] }] });

test("pages: a tree you can move in, a trash you can come back from, copies — and nothing goes inside itself", async () => {
  const s = await import("@/plugins/workspace/store");
  const a = s.createPage({ title: "Alpha", icon: "📘" });
  const b = s.createPage({ title: "Beta" });
  const a1 = s.createPage({ title: "Alpha one", parentId: a, content: doc("Hello") });
  const a2 = s.createPage({ title: "Alpha two", parentId: a });
  assert.deepEqual(s.tree().map((t): [number, number | null] => [t.id, t.parentId]).sort((x, y) => x[0] - y[0]), [[a, null], [b, null], [a1, a], [a2, a]]);
  // Move Beta into Alpha, before "Alpha two"; then Alpha's children are in that order.
  s.movePage(b, a, a2);
  assert.deepEqual(s.tree().filter((t) => t.parentId === a).map((t) => t.id), [a1, b, a2]);
  assert.throws(() => s.movePage(a, a1), /inside itself/);
  assert.throws(() => s.movePage(a, b), /inside itself/);
  assert.deepEqual(s.breadcrumbs(a1).map((x) => x.title), ["Alpha"]);

  // Trash: the page and what is below it go; restoring brings them back.
  s.archivePage(a);
  assert.equal(s.tree().length, 0);
  assert.deepEqual(s.trash().map((t) => [t.title, t.below]), [["Alpha", 3]]);
  assert.equal(s.search("hello").length, 0, "the trash isn't searched");
  s.restorePage(a);
  assert.equal(s.tree().length, 4);
  assert.equal(s.search("hello")[0].id, a1);

  // A copy has the pages below it.
  const copy = s.duplicatePage(a);
  assert.equal(s.getPage(copy)!.title, "Alpha (copy)");
  assert.equal(s.tree().filter((t) => t.parentId === copy).length, 3);

  s.deletePage(copy);
  assert.equal(s.getPage(copy), null);
  assert.equal(s.tree().length, 4);
});

test("pages: saving keeps versions (one per ten minutes), reports a conflict, finds by words and by backlinks and mentions", async () => {
  const s = await import("@/plugins/workspace/store");
  const target = s.createPage({ title: "Launch plan" });
  const p = s.createPage({ title: "Notes", content: doc("first draft") });
  const r1 = s.updatePage(p, { content: doc("second draft with Navigation") }, 1);
  assert.equal(r1.ok, true);
  const rev = r1.ok ? r1.rev : 0;
  assert.equal(rev, 2);
  // A change from a stale editor doesn't overwrite.
  const stale = s.updatePage(p, { content: doc("lost") }, 1);
  assert.deepEqual(stale, { ok: false, conflict: true, rev: 2 });
  assert.match(JSON.stringify(s.getPage(p)!.content), /second draft/);
  // The state before the first change is a version; the next quick one adds none.
  assert.equal(s.versions(p).length, 1);
  s.updatePage(p, { content: doc("third draft") }, rev);
  assert.equal(s.versions(p).length, 1);
  assert.match(JSON.stringify(s.getVersion(s.versions(p)[0].id)!.content), /first draft/);
  s.restoreVersion(s.versions(p)[0].id);
  assert.match(JSON.stringify(s.getPage(p)!.content), /first draft/);
  assert.equal(s.versions(p).length, 2, "what was there before restoring is kept too");

  // Mentions become links: pages, people, tickets.
  s.updatePage(p, {
    content: doc("see ", [
      { type: "zeffRef", attrs: { kind: "page", ref: String(target), label: "Launch plan", href: `/workspace/${target}` } },
      { type: "text", text: " and " },
      { type: "zeffRef", attrs: { kind: "person", ref: "5", label: "Anna" } },
      { type: "text", text: " on " },
      { type: "zeffRef", attrs: { kind: "ticket", ref: "PROJ-339", label: "PROJ-339" } },
    ]),
  });
  assert.deepEqual(s.backlinks(target).map((x) => x.id), [p]);
  assert.deepEqual(s.pagesMentioning("person", 5).map((x) => x.id), [p]);
  assert.deepEqual(s.pagesMentioning("ticket", "PROJ-339").map((x) => x.id), [p]);
  // Words by their beginnings; titles count more.
  assert.equal(s.search("launch")[0].id, target);
  assert.equal(s.search("Anna")[0].id, p);
  assert.deepEqual(s.suggestPages("laun").map((x) => x.id), [target]);

  // Favorites and recent.
  s.updatePage(p, { favorite: true });
  assert.deepEqual(s.favorites().map((x) => x.id), [p]);
  assert.ok(s.recent().some((x) => x.id === p));
});

test("databases: rows are pages with cells that fit their property; the schema's changes carry to the rows; relations clean up", async () => {
  const s = await import("@/plugins/workspace/store");
  const { newProperty, newView } = await import("@/plugins/workspace/model");
  const projects = s.createPage({ title: "Projects", kind: "database" });
  const tasks = s.createPage({ title: "Tasks", kind: "database" });
  const status = newProperty("Status", "status");
  const hours = newProperty("Hours", "number");
  const tags = { ...newProperty("Tags", "multi_select"), options: [{ id: "a", name: "A", color: "red" }, { id: "b", name: "B", color: "blue" }] };
  const project = { ...newProperty("Project", "relation"), relationDb: projects };
  const t0 = s.getDatabase(tasks)!.schema;
  s.updateSchema(tasks, { ...t0, properties: [status, hours, tags, project], views: [...t0.views, newView("Board", "board")] });
  // The other side of the relation, computed.
  const p0 = s.getDatabase(projects)!.schema;
  const back = { ...newProperty("Tasks", "relation"), relationDb: tasks, backOf: project.id };
  const total = { ...newProperty("Hours", "rollup"), rollup: { relation: back.id, property: hours.id, fn: "sum" as const } };
  s.updateSchema(projects, { ...p0, properties: [back, total] });

  const relaunch = s.addRow(projects, { title: "Relaunch" });
  const t1 = s.addRow(tasks, { title: "Design", cells: { [hours.id]: "3,5", [project.id]: [relaunch], [tags.id]: ["a", "zzz"], [status.id]: "nonsense" } });
  const t2 = s.addRow(tasks, { title: "Build", cells: { [hours.id]: 4, [project.id]: [relaunch, 99999] } });
  const row1 = s.rawRows(tasks).find((r) => r.id === t1)!;
  assert.equal(row1.cells[hours.id], 3.5, "text fitted to a number");
  assert.deepEqual(row1.cells[tags.id], ["a"], "unknown options dropped");
  assert.equal(row1.cells[status.id], undefined, "a status that isn't an option is dropped");
  assert.throws(() => s.setCell(t1, back.id, [1]), /computed|No such property/);

  s.setCell(t2, status.id, status.options![1].id);
  s.setCell(t2, "title", "Build it");
  assert.equal(s.getPage(t2)!.title, "Build it");
  const rows = s.rowsOf(projects)!.rows;
  assert.deepEqual(rows[0].cells[back.id], [t1, t2]);
  assert.equal(rows[0].cells[total.id], 7.5);
  const labels = await s.labelsFor(s.getDatabase(projects)!.schema, rows);
  assert.equal(labels.pages[t1].title, "Design");

  // A row's page is a page: it has a body, and shows under its database in the breadcrumbs.
  s.updatePage(t1, { content: doc("Design notes") });
  assert.deepEqual(s.breadcrumbs(t1).map((x) => x.title), ["Tasks"]);
  assert.equal(s.search("design notes")[0].id, t1);
  assert.ok(!s.tree().some((t) => t.id === t1), "rows aren't in the page tree");

  // Dropping a property takes its cells; deleting a page takes it out of the relations.
  s.updateSchema(tasks, { ...s.getDatabase(tasks)!.schema, properties: [status, tags, project] });
  assert.equal(s.rawRows(tasks).find((r) => r.id === t1)!.cells[hours.id], undefined);
  s.deletePage(relaunch);
  assert.equal(s.rawRows(tasks).find((r) => r.id === t1)!.cells[project.id], undefined);

  // A template row: its content and cells come into a new row; it isn't one of the rows.
  const tpl = s.addRow(tasks, { title: "Bug report", cells: { [tags.id]: ["b"] } });
  s.updatePage(tpl, { content: doc("Steps to reproduce"), template: true });
  assert.ok(!s.rawRows(tasks).some((r) => r.id === tpl));
  assert.equal(s.rowTemplates(tasks).length, 1);
  const fromTpl = s.addRow(tasks, { templateId: tpl });
  assert.equal(s.getPage(fromTpl)!.title, "Bug report");
  assert.deepEqual(s.getPage(fromTpl)!.props[tags.id], ["b"]);
  assert.match(JSON.stringify(s.getPage(fromTpl)!.content), /Steps to reproduce/);

  // Copying a database copies its rows.
  const copy = s.duplicatePage(tasks);
  assert.equal(s.rawRows(copy).length, s.rawRows(tasks).length);
  s.archivePage(tasks);
  assert.equal(s.rawRows(tasks).length, 0, "rows go to the trash with their database");
});

test("a document with every kind of block saves and comes back whole", async () => {
  const s = await import("@/plugins/workspace/store");
  const t = (text: string, marks?: object[]) => ({ type: "text", text, ...(marks ? { marks } : {}) });
  const p = (...c: object[]) => ({ type: "paragraph", content: c });
  const full = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 }, content: [t("Heading")] },
      p(t("bold", [{ type: "bold" }]), t(" "), t("link", [{ type: "link", attrs: { href: "https://example.com" } }]), { type: "zeffRef", attrs: { kind: "ticket", ref: "PROJ-1", label: "PROJ-1", href: "" } }),
      { type: "callout", attrs: { icon: "⚠️", tone: "yellow" }, content: [p(t("careful"))] },
      { type: "bulletList", content: [{ type: "listItem", content: [p(t("one")), { type: "bulletList", content: [{ type: "listItem", content: [p(t("nested"))] }] }] }] },
      { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [p(t("done"))] }] },
      { type: "codeBlock", attrs: { language: "ts" }, content: [t("const a = 1;")] },
      { type: "details", attrs: { open: true }, content: [{ type: "detailsSummary", content: [t("Toggle")] }, { type: "detailsContent", content: [p(t("inside"))] }] },
      { type: "table", content: [{ type: "tableRow", content: [{ type: "tableHeader", attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [p(t("H"))] }] }, { type: "tableRow", content: [{ type: "tableCell", attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [p(t("c"))] }] }] },
      { type: "horizontalRule" },
      { type: "databaseView", attrs: { dbId: 5, viewId: "", title: "DB" } },
    ],
  };
  const id = s.createPage({ title: "Everything" });
  const r = s.updatePage(id, { content: full }, 1);
  assert.equal(r.ok, true, JSON.stringify(r));
  const back = JSON.stringify(s.getPage(id)!.content);
  for (const kind of ["callout", "bulletList", "taskList", "codeBlock", "details", "detailsSummary", "detailsContent", "table", "tableHeader", "tableCell", "horizontalRule", "databaseView", "zeffRef"]) assert.ok(back.includes(`"${kind}"`), `${kind} kept`);
  assert.ok(back.includes("https://example.com"));
});
