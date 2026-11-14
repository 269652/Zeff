import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * Versions of the parts that had none — a flow, a database's fields, a routine, a form: kept before each change, listed, brought back
 * (safely: a flow keeps today's permissions, fields added since stay with their data); and a kept version of an app made a new app or a
 * template beside the installed one.
 */

async function world() {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "todos"]) setInstalled(id, true);
  await import("@/plugins/contributions");
  return {
    w: await import("@/plugins/workspace/store"),
    pv: await import("@/plugins/workspace/part-versions"),
    restore: (await import("@/plugins/workspace/part-restore")).restorePart,
  };
}

test("a flow: each change keeps the one before; brought back with the permissions it has now", async () => {
  const { pv, restore } = await world();
  const fs = await import("@/plugins/workspace/flows/store");
  const f = fs.createFlow({ name: "pv.greet", title: "Greet", nodes: [{ id: "a", kind: "action", action: "text.template", input: { template: "one" } }], permissions: {} });
  fs.saveFlow(f.pageId, { ...fs.getFlow(f.pageId)!, nodes: [{ id: "a", kind: "action", action: "text.template", input: { template: "two" } }] });
  fs.saveFlow(f.pageId, { ...fs.getFlow(f.pageId)!, permissions: { ai: true } });
  const list = pv.partVersions("flow", f.pageId);
  assert.equal(list.length, 2);
  // Saving the same again keeps nothing new.
  fs.saveFlow(f.pageId, fs.getFlow(f.pageId)!);
  assert.equal(pv.partVersions("flow", f.pageId).length, 2);
  const first = list[list.length - 1];
  assert.match(JSON.stringify(pv.partVersion(first.id)!.body), /"one"/);
  await restore(first.id);
  const now = fs.getFlow(f.pageId)!;
  assert.match(JSON.stringify(now.nodes), /"one"/);
  assert.deepEqual(now.permissions, { ai: true }, "an old version does not change the permissions");
  assert.equal(pv.partVersions("flow", f.pageId).length, 3, "what it was before the restore is a version too");
});

test("a database's fields: kept before a change; a restore brings them back but keeps fields added since, with their data", async () => {
  const { w, pv, restore } = await world();
  const dbId = w.createPage({ title: "Things", kind: "database" });
  const sch = w.getDatabase(dbId)!.schema;
  w.updateSchema(dbId, { ...sch, properties: [...sch.properties, { id: "p1", name: "Colour", type: "text" }] });
  const row = w.addRow(dbId, { title: "Ball", cells: { p1: "red" } });
  w.updateSchema(dbId, { ...w.getDatabase(dbId)!.schema, properties: w.getDatabase(dbId)!.schema.properties.map((p) => (p.id === "p1" ? { ...p, name: "Farbe" } : p)) });
  w.updateSchema(dbId, { ...w.getDatabase(dbId)!.schema, properties: [...w.getDatabase(dbId)!.schema.properties, { id: "p2", name: "Size", type: "number" }] });
  w.setCell(row, "p2", 3);
  // A view's template changing alone keeps no version of the fields.
  const n = pv.partVersions("fields", dbId).length;
  w.updateSchema(dbId, { ...w.getDatabase(dbId)!.schema, views: w.getDatabase(dbId)!.schema.views.map((v) => ({ ...v, name: v.name + "!" })) });
  assert.equal(pv.partVersions("fields", dbId).length, n);
  // Back to "Colour": the name comes back; "Size", added since, stays — and so does its value.
  const withColour = pv.partVersions("fields", dbId).find((v) => JSON.stringify(pv.partVersion(v.id)!.body).includes('"Colour"'))!;
  await restore(withColour.id);
  const props = w.getDatabase(dbId)!.schema.properties;
  assert.equal(props.find((p) => p.id === "p1")!.name, "Colour");
  assert.ok(props.some((p) => p.id === "p2"), "a field added since stays");
  assert.equal(w.rawRows(dbId).find((r) => r.id === row)!.cells.p2, 3);
  assert.equal(w.rawRows(dbId).find((r) => r.id === row)!.cells.p1, "red");
});

test("a routine and a form: versions kept and brought back", async () => {
  const { w, pv, restore } = await world();
  const r = await import("@/plugins/workspace/routines");
  const page = w.createPage({ title: "Nightly" });
  r.createRoutine(page, "automation", { steps: [] });
  r.updateRoutine(page, { triggers: [{ kind: "schedule", every: "day", at: "06:00" }] as never });
  r.updateRoutine(page, { triggers: [{ kind: "schedule", every: "day", at: "07:00" }] as never });
  const versions = pv.partVersions("routine", page);
  assert.equal(versions.length, 2);
  await restore(versions[0].id);
  assert.match(JSON.stringify(r.getRoutine(page)!.triggers), /06:00/);

  const forms = await import("@/plugins/workspace/forms");
  const dbId = w.createPage({ title: "Answers", kind: "database" });
  const formId = forms.createForm({ dbId, title: "Ask" });
  const before = forms.getForm(formId)!.def;
  forms.saveForm(formId, { ...before, title: "Changed" });
  const fv = pv.partVersions("form", formId);
  assert.equal(fv.length, 1);
  // Saved again right away (the designer's autosave): no new version within a few minutes.
  forms.saveForm(formId, { ...before, title: "Changed again" });
  assert.equal(pv.partVersions("form", formId).length, 1);
  await restore(fv[0].id);
  assert.equal(JSON.stringify(forms.getForm(formId)!.def.title ?? null), JSON.stringify(before.title ?? null));
});

test("a kept version of an app: made a new app and a template beside the installed one", async () => {
  const { w } = await world();
  const life = await import("@/plugins/workspace/package-life");
  const schemaOf = (props: unknown[]) => ({ titleName: "Name", properties: props, views: [{ id: "all", name: "All", type: "table", filter: { and: [] }, sorts: [], hidden: [] }] });
  const pkg = (version: string, field: string) => ({ format: 1 as const, id: "snapapp", name: "Snap", version, items: [{ id: "i1", kind: "page", title: "Snap" }, { id: "i2", parent: "i1", kind: "database", title: "Items", schema: schemaOf([{ id: "f", name: field, type: "text" }]), rows: [{ id: "r1", title: "One", cells: {} }] }] });
  await life.installTracked(pkg("1.0.0", "Old") as never, null);
  await life.updateTracked("snapapp", pkg("1.1.0", "New") as never);
  const installedRoot = life.getInstalled("snapapp")!.rootId;
  const made = await life.snapshotAsNew("snapapp", "1.0.0");
  assert.notEqual(made.rootId, installedRoot);
  assert.match(made.title, /1\.0\.0/);
  const db = w.subtree(made.rootId).map((id) => w.getPage(id)!).find((p) => p.kind === "database")!;
  assert.deepEqual(w.getDatabase(db.id)!.schema.properties.map((p) => p.name), ["Old"], "the old version's fields");
  assert.equal(w.rawRows(db.id).length, 0, "a version keeps the structure, not the entries");
  assert.equal(life.getInstalled("snapapp")!.version, "1.1.0", "the installed app stays as it is");
  const tpl = await life.snapshotAsNew("snapapp", "1.1.0", { template: true });
  const { inTemplates } = w;
  assert.ok(inTemplates(tpl.rootId));
  assert.throws(() => life.snapshotPackage("snapapp", "9.9.9"), /No snapshot/);
  await assert.rejects(() => life.snapshotAsNew("snapapp", "9.9.9"), /No snapshot/);
});

test("the whole app: save points of every page below its top page — kept by hand and before an update, brought back, made a new app", async () => {
  const { w } = await world();
  const life = await import("@/plugins/workspace/package-life");
  const schemaOf = (props: unknown[]) => ({ titleName: "Name", properties: props, views: [{ id: "all", name: "All", type: "table", filter: { and: [] }, sorts: [], hidden: [] }] });
  const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
  const pkg = (version: string, intro: string) => ({ format: 1 as const, id: "spapp", name: "SP", version, items: [{ id: "i1", kind: "page", title: "SP", content: doc(intro) }, { id: "i2", parent: "i1", kind: "database", title: "Items", schema: schemaOf([{ id: "f", name: "Colour", type: "text" }]) }] });
  await life.installTracked(pkg("1.0.0", "Hello") as never, null);
  const inst = life.getInstalled("spapp")!;
  const dbId = inst.map.i2;
  // Yours: a page of your own below the app, a field renamed, an entry.
  const mine = w.createPage({ parentId: inst.rootId, title: "My notes", content: doc("first") as never });
  w.updateSchema(dbId, { ...w.getDatabase(dbId)!.schema, properties: w.getDatabase(dbId)!.schema.properties.map((p) => (p.name === "Colour" ? { ...p, name: "Farbe" } : p)) });
  const row = w.addRow(dbId, { title: "Ball" });
  const sp = life.keepAppState("spapp", "as I like it")!;
  assert.equal(sp.n, 1);
  assert.equal(life.keepAppState("spapp", "again"), null, "nothing changed: no second one");
  assert.ok(Object.values(life.getInstalled("spapp")!.map).includes(mine), "a page of your own below the app becomes part of it");
  // More changes, then back to the save point: all of it at once; the entry stays; your page is not made twice.
  w.updatePage(mine, { content: doc("second") as never });
  w.updateSchema(dbId, { ...w.getDatabase(dbId)!.schema, properties: w.getDatabase(dbId)!.schema.properties.map((p) => (p.name === "Farbe" ? { ...p, name: "Hue" } : p)) });
  await life.restoreSavePoint("spapp", sp.n);
  assert.ok(w.getDatabase(dbId)!.schema.properties.some((p) => p.name === "Farbe"));
  assert.match(JSON.stringify(w.getPage(mine)!.content), /first/);
  assert.equal(w.subtree(inst.rootId).map((id) => w.getPage(id)!).filter((p) => p.title === "My notes" && !p.archivedAt).length, 1);
  assert.ok(w.rawRows(dbId).some((r) => r.id === row), "entries stay");
  const points = life.appHistory("spapp").savePoints;
  assert.match(points[0].label, /Before going back/, "what it was before going back is kept too");
  assert.equal(points[0].auto, true);
  // An update keeps one by itself first.
  await life.updateTracked("spapp", pkg("1.1.0", "Hello again") as never);
  assert.match(life.appHistory("spapp").savePoints[0].label, /Before the update to 1\.1\.0/);
  assert.deepEqual(life.appHistory("spapp").versions, ["1.1.0", "1.0.0"]);
  // A save point as a new app beside it.
  const copy = await life.savePointAsNew("spapp", sp.n);
  assert.notEqual(copy.rootId, inst.rootId);
  assert.ok(w.subtree(copy.rootId).some((id) => w.getPage(id)!.title === "My notes"));
  assert.equal(life.appOfPage(inst.rootId)!.id, "spapp");
  assert.equal(life.appOfPage(copy.rootId), null, "the copy is an app of its own, not the installed one");
});
