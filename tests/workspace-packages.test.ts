import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * Packages: a whole app — pages, databases with their fields and views, the layout blocks, the routines — as one thing that can be
 * exported from a page tree and installed again (a plugin can ship one). Installing makes new pages with new ids and puts every
 * reference right: a relation, a linked database, a routine's step. Routines come in switched off.
 */
async function app() {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "work", "todos"]) setInstalled(id, true);
  const w = await import("@/plugins/workspace/store");
  const r = await import("@/plugins/workspace/routines");
  const root = w.createPage({ title: "Projektverwaltung", icon: "📁" });
  const projects = w.createPage({ parentId: root, kind: "database", title: "Projekte" });
  w.updateSchema(projects, { ...w.getDatabase(projects)!.schema, properties: [{ id: "phase", name: "Phase", type: "select", options: [{ id: "o1", name: "Offen", color: "gray" }, { id: "o2", name: "Fertig", color: "green" }] }] });
  const tasks = w.createPage({ parentId: root, kind: "database", title: "Aufgaben" });
  const outside = w.createPage({ kind: "database", title: "Ganz woanders" });
  w.updateSchema(tasks, {
    ...w.getDatabase(tasks)!.schema,
    properties: [
      { id: "proj", name: "Projekt", type: "relation", relationDb: projects },
      { id: "ext", name: "Extern", type: "relation", relationDb: outside },
      { id: "status", name: "Status", type: "select", options: [{ id: "s1", name: "Offen", color: "gray" }, { id: "s2", name: "Erledigt", color: "green" }] },
    ],
  });
  w.addRow(projects, { title: "Relaunch" });
  const cockpit = w.createPage({
    parentId: root,
    title: "Cockpit",
    content: { type: "doc", content: [{ type: "zeffForm", attrs: { dbId: tasks, fields: '["status"]', label: "Aufgabe anlegen" } }, { type: "zeffRelated", attrs: { dbId: tasks, prop: "proj" } }, { type: "databaseView", attrs: { dbId: tasks, viewId: "", title: "Alle Aufgaben" } }] },
  });
  const auto = w.createPage({ parentId: root, title: "Aufräumen" });
  r.createRoutine(auto, "automation", {
    enabled: true,
    triggers: [{ kind: "event", event: "row.changed", db: tasks, field: "Status" }],
    steps: [{ id: "a", kind: "foreach", db: tasks, steps: [{ id: "b", kind: "create", db: projects, title: "Neu" }, { id: "c", kind: "pipeline", db: tasks }] }],
  });
  return { w, r, root, projects, tasks, outside, cockpit, auto };
}

test("export: the tree as a package — references by local number, nothing of the real ids left, what points outside dropped", async () => {
  const { projects, tasks, root } = await app();
  const { exportPackage } = await import("@/plugins/workspace/packages");
  const pkg = exportPackage(root, { name: "Projektverwaltung", description: "Projekte und ihre Aufgaben" });
  assert.equal(pkg.format, 1);
  assert.equal(pkg.items.length, 5, "the page, two databases, the cockpit, the routine");
  const byTitle = (t: string) => pkg.items.find((i) => i.title === t)!;
  assert.equal(byTitle("Projektverwaltung").parent, undefined);
  assert.equal(byTitle("Projekte").parent, byTitle("Projektverwaltung").id, "parent by local id");
  const tasksItem = byTitle("Aufgaben");
  const props = tasksItem.schema!.properties;
  assert.equal(props.find((p) => p.id === "proj")!.relationDb, byTitle("Projekte").id, "a relation inside the package: by local id");
  assert.ok(!props.some((p) => p.id === "ext"), "a relation to something outside is dropped");
  const text = JSON.stringify(pkg);
  assert.ok(!new RegExp(`"(dbId|db|relationDb)":(${projects}|${tasks})[,}]`).test(text), "no real id of a database is left");
  assert.equal(byTitle("Aufräumen").routine!.kind, "automation");
  assert.equal(pkg.items.find((i) => i.rows)?.rows, undefined, "no rows unless asked for");
  const withRows = exportPackage(root, { name: "x", includeRows: true });
  assert.deepEqual(withRows.items.find((i) => i.title === "Projekte")!.rows!.map((r) => r.title), ["Relaunch"]);
});

test("install: new pages with new ids, every reference put right — twice is two apps, routines come in switched off", async () => {
  const { w, r, root } = await app();
  const { exportPackage, installPackage } = await import("@/plugins/workspace/packages");
  const pkg = exportPackage(root, { name: "Projektverwaltung" });
  const target = w.createPage({ title: "Ablage" });
  const first = installPackage(pkg, target);
  const second = installPackage(pkg, target);
  assert.notEqual(first.rootId, second.rootId);
  assert.equal(w.getPage(first.rootId)!.parentId, target);
  const kids = (id: number) => w.tree().filter((x) => x.parentId === id);
  const dbs = (id: number) => Object.fromEntries(kids(id).filter((x) => x.kind === "database").map((x) => [x.title, x.id]));
  const a = dbs(first.rootId);
  const b = dbs(second.rootId);
  assert.notEqual(a["Aufgaben"], b["Aufgaben"]);
  const rel = (dbId: number) => w.getDatabase(dbId)!.schema.properties.find((p) => p.id === "proj")!.relationDb;
  assert.equal(rel(a["Aufgaben"]), a["Projekte"], "the first app's tasks point to the first app's projects");
  assert.equal(rel(b["Aufgaben"]), b["Projekte"]);
  assert.equal(JSON.stringify(w.getPage(kids(first.rootId).find((x) => x.title === "Cockpit")!.id)!.content).match(new RegExp(`"dbId":${a["Aufgaben"]}`, "g"))?.length, 3, "form, related list and linked database follow");
  const routine = kids(first.rootId).find((x) => x.title === "Aufräumen")!;
  const rt = r.getRoutine(routine.id)!;
  assert.equal(rt.enabled, false, "switched off");
  assert.deepEqual(rt.triggers, [{ kind: "event", event: "row.changed", db: a["Aufgaben"], field: "Status" }]);
  const loop = rt.steps[0] as { db: number; steps: { db: number }[] };
  assert.equal(loop.db, a["Aufgaben"]);
  assert.deepEqual(loop.steps.map((s) => s.db), [a["Projekte"], a["Aufgaben"]]);
  assert.equal(w.rawRows(a["Projekte"]).length, 0, "no rows came along");
});

test("install with rows: the sample rows come in too", async () => {
  const { w, root } = await app();
  const { exportPackage, installPackage } = await import("@/plugins/workspace/packages");
  const r = installPackage(exportPackage(root, { name: "Mit Beispielen", includeRows: true }), null);
  const projects = w.tree().find((x) => x.parentId === r.rootId && x.title === "Projekte")!;
  assert.deepEqual(w.rawRows(projects.id).map((x) => x.title), ["Relaunch"]);
});

test("a package that is not one is refused — and what it holds is cleaned like any page", async () => {
  const { installPackage } = await import("@/plugins/workspace/packages");
  assert.throws(() => installPackage({ format: 2, name: "x", items: [] } as never, null), /package/i);
  assert.throws(() => installPackage({ format: 1, name: "x", items: [] }, null), /nothing|empty/i);
  assert.throws(() => installPackage({ format: 1, name: "x", items: Array.from({ length: 500 }, (_, i) => ({ id: i + 1, kind: "page", title: "x" })) } as never, null), /too many|large/i);
  assert.throws(() => installPackage({ format: 1, name: "x", items: [{ id: 1, kind: "page", title: "a", parent: 99 }] } as never, null), /parent/i);
  const { w } = await app();
  const r = installPackage({ format: 1, name: "Sauber", items: [{ id: 1, kind: "page", title: "Seite", content: { type: "doc", content: [{ type: "script", content: [] }, { type: "paragraph", content: [{ type: "text", text: "ok" }] }] } }] } as never, null);
  assert.equal(JSON.stringify(w.getPage(r.rootId)!.content).includes("script"), false);
});

test("no packages of its own: Zeff's ready-made things are the templates (Projects & tasks was one twice)", async () => {
  await app();
  const { listPackages } = await import("@/plugins/workspace/packages");
  const { templateMetas } = await import("@/plugins/workspace/templates");
  assert.ok(!listPackages().some((p) => p.id === "projects-tasks"));
  assert.ok(!templateMetas().some((m) => m.key === "pkg:projects-tasks"));
  assert.ok(templateMetas().some((m) => m.key === "projects"));
});
