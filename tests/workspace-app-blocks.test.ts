import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** The blocks an app's layout is made of: a field of the row, a list of the rows that belong to it, a button. */
async function twoDatabases() {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("workspace", true);
  const w = await import("@/plugins/workspace/store");
  const projects = w.createPage({ kind: "database", title: "Projekte" });
  w.updateSchema(projects, { ...w.getDatabase(projects)!.schema, properties: [{ id: "phase", name: "Phase", type: "select", options: [{ id: "o1", name: "Offen", color: "gray" }, { id: "o2", name: "Fertig", color: "green" }] }] });
  const tasks = w.createPage({ kind: "database", title: "Aufgaben" });
  w.updateSchema(tasks, { ...w.getDatabase(tasks)!.schema, properties: [{ id: "proj", name: "Projekt", type: "relation", relationDb: projects }, { id: "done", name: "Erledigt", type: "checkbox" }] });
  return { w, projects, tasks };
}

test("layout choices: the fields of the row's database, and the databases whose rows belong to it", async () => {
  const { w, projects, tasks } = await twoDatabases();
  const { layoutChoices } = await import("@/plugins/workspace/app-blocks");
  const row = w.addRow(projects, { title: "Relaunch" });
  const c = layoutChoices(row);
  assert.equal(c.dbId, projects, "a row's page is about its database");
  assert.deepEqual(c.properties.map((p) => p.id), ["title", "phase"]);
  assert.deepEqual(c.related.map((r) => [r.dbId, r.prop]), [[tasks, "proj"]]);
  assert.equal(layoutChoices(w.createPage({ title: "Seite" })).dbId, null, "a page that isn't a row has none");
});

test("related list: the rows that point to this one — and a new one made pointing to it", async () => {
  const { w, projects, tasks } = await twoDatabases();
  const { relatedRows, addRelatedRow } = await import("@/plugins/workspace/app-blocks");
  const a = w.addRow(projects, { title: "A" });
  const b = w.addRow(projects, { title: "B" });
  const t1 = addRelatedRow(a, tasks, "proj", "Design");
  addRelatedRow(a, tasks, "proj", "Bauen");
  addRelatedRow(b, tasks, "proj", "Andere");
  assert.deepEqual(relatedRows(a, tasks, "proj").map((r) => r.title).sort(), ["Bauen", "Design"]);
  assert.deepEqual(relatedRows(b, tasks, "proj").map((r) => r.title), ["Andere"]);
  assert.equal(w.getPage(t1)!.dbId, tasks);
  assert.throws(() => addRelatedRow(a, tasks, "proj", "  "), /title/i);
  assert.throws(() => addRelatedRow(a, tasks, "done", "x"), /relation/i, "only a relation");
});

test("buttons: set a field of the row, trash it, read the sources again", async () => {
  const { w, projects } = await twoDatabases();
  const { runRowButton } = await import("@/plugins/workspace/app-blocks");
  const row = w.addRow(projects, { title: "Relaunch" });
  const r = await runRowButton(row, { action: "set", prop: "phase", value: "Fertig" });
  assert.match(r.message, /Phase/);
  const cell = w.rawRows(projects).find((x) => x.id === row)!.cells.phase;
  assert.equal(w.getDatabase(projects)!.schema.properties.find((p) => p.id === "phase")!.options!.find((o) => o.id === cell)!.name, "Fertig");
  await assert.rejects(() => runRowButton(row, { action: "set", prop: "nope", value: "x" }), /field/i);
  await assert.rejects(() => runRowButton(w.createPage({ title: "Seite" }), { action: "trash" }), /not a row/i);
  await runRowButton(row, { action: "trash" });
  assert.ok(w.getPage(row)!.archivedAt, "in the trash");
  const row2 = w.addRow(projects, { title: "Zwei" });
  assert.match((await runRowButton(row2, { action: "refresh" })).message, /sources/i);
});

test("the blocks in a page: a field, a related list, a button — their attributes kept to what they can be", async () => {
  const { sanitizeDoc } = await import("@/plugins/workspace/doc");
  const doc = sanitizeDoc({
    type: "doc",
    content: [
      { type: "zeffField", attrs: { prop: "phase", label: false, evil: 1 } },
      { type: "zeffRelated", attrs: { dbId: "7", prop: "proj" } },
      { type: "zeffRelated", attrs: { dbId: "nonsense", prop: "proj" } },
      { type: "zeffButton", attrs: { label: "Fertig", action: "set", prop: "phase", value: "Fertig" } },
      { type: "zeffButton", attrs: { label: "x", action: "rm -rf" } },
    ],
  }) as { content: { type: string; attrs?: Record<string, unknown> }[] };
  assert.deepEqual(doc.content.map((n) => n.type), ["zeffField", "zeffRelated", "zeffButton", "zeffButton"], "a related list needs its database");
  assert.deepEqual(doc.content[0].attrs, { prop: "phase", label: false });
  assert.equal(doc.content[1].attrs!.dbId, 7);
  assert.equal(doc.content[3].attrs!.action, "set", "an unknown action is the default one");
});
