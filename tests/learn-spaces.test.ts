import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const plan = {
  title: "French",
  summary: "From greetings to B2.",
  years: 1,
  sources: [{ id: "s1", title: "Grammaire progressive", year: 2010 }],
  nodes: [
    { key: "y1", kind: "year", parent: null, title: "Year 1" },
    { key: "p1", kind: "phase", parent: "y1", title: "Basics" },
    { key: "a", kind: "skill", parent: "p1", title: "Greetings", path: "Core" },
    { key: "a1", kind: "step", parent: "a", title: "Bonjour", sources: ["s1"] },
    { key: "a2", kind: "step", parent: "a", title: "Vous and tu", requires: ["a1"] },
  ],
};

async function setup() {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("learn", true);
  setInstalled("workspace", true);
  await import("@/plugins/contributions");
  const store = await import("@/plugins/learn/store");
  const dbs = await import("@/plugins/learn/dbs");
  const ws = await import("@/plugins/workspace/store");
  return { store, dbs, ws };
}

test("a learning space is told from its children: the template makes one, its page shows Learn, and its courses are its own", async () => {
  const { store, dbs, ws } = await setup();
  const first = dbs.learnDbs();
  const { templateMetas } = await import("@/plugins/workspace/templates");
  const meta = templateMetas().find((m) => m.key === "plugin:learn.learning-space");
  assert.ok(meta, "offered under New → templates");
  const { workspaceTemplates } = await import("@/plugins/workspace/page-apps-point");
  const folder = workspaceTemplates.list().find((c) => c.plugin === "learn")!.impl[0].build(null);
  const second = dbs.learnSpaceAt(folder);
  assert.ok(second, "the new page is a learning space");
  assert.notEqual(second!.courses, first.courses, "with databases of its own");
  for (const k of ["courses", "steps", "exercises", "activity", "cards", "messages"] as const) assert.equal(ws.getPage(second![k])?.parentId, folder, `${k} under it`);
  assert.deepEqual(
    dbs.learnSpaces().map((s) => s.folder),
    [first.folder, folder],
  );
  assert.equal(dbs.learnSpaceAt(ws.createPage({ title: "Just a page" })), null, "an ordinary page is none");

  const a = store.createCourse({ topic: "Geometry", goal: "", level: "" });
  const b = store.createCourse({ topic: "French", goal: "B2", level: "school", space: folder });
  store.savePlan(b, plan);
  assert.deepEqual(
    store.listCourses(folder).map((c) => c.id),
    [b],
  );
  assert.deepEqual(
    store.listCourses(first.folder).map((c) => c.id),
    [a],
  );
  assert.equal(store.listCourses().length, 2, "all of them");
  // What the course does goes into its own space's databases.
  const steps = ws.rawRows(second!.steps);
  assert.equal(steps.length, 5, "its steps in its space");
  assert.equal(ws.rawRows(first.steps).length, 0);
  store.masterNode(b, "a1");
  assert.ok(ws.rawRows(second!.activity).length > 0, "its activity too");
  store.addCards(b, "a1", [{ front: "Hello", back: "Bonjour" }]);
  assert.equal(ws.rawRows(second!.cards).length, 1);
  assert.equal(store.courseTree(b).tree.progress.mastered, 1, "its progress");
  assert.equal(dbs.spaceOfPage(b)?.folder, folder, "a course knows its space");

  const { pageApp } = await import("@/plugins/workspace/page-apps");
  assert.ok(await pageApp(folder), "its page shows Learn");
  assert.equal(await pageApp(ws.createPage({ title: "Other" })), null);
});

test("a space is found again from its databases alone — a package of it (with rows) imported is a learning space with its progress", async () => {
  const { store, dbs, ws } = await setup();
  const folder = dbs.createLearnSpace(null, "Sprachen");
  const c = store.createCourse({ topic: "French", goal: "", level: "", space: folder });
  store.savePlan(c, plan);
  store.masterNode(c, "a1");
  store.addCards(c, "a1", [{ front: "Hello", back: "Bonjour" }]);
  const w = store.addWidget({ courseId: c, nodeKey: "a1", title: "Quiz", html: "<p>Quiz</p><script>1</script>" });

  const { exportPackage, installPackage } = await import("@/plugins/workspace/packages");
  const pkg = JSON.parse(JSON.stringify(exportPackage(folder, { name: "Sprachen", includeRows: true })));
  const { rootId } = installPackage(pkg, null);
  const copy = dbs.learnSpaceAt(rootId);
  assert.ok(copy, "the imported page is a learning space");
  const [course] = store.listCourses(rootId);
  assert.ok(course && course.id !== c, "with its course, a new row");
  assert.equal(course.title, "French");
  assert.equal(store.courseTree(course.id).tree.progress.mastered, 1, "and its progress — the steps still linked to it and each other");
  assert.equal(store.courseNodes(course.id).find((n) => n.key === "a2")?.requires.length, 1, "a step's requirement kept");
  assert.equal(store.dueCards(course.id, new Date(Date.now() + 86400000 * 400)).length, 1, "its cards");
  const ex = ws.rawRows(copy!.exercises)[0];
  assert.ok(ex, "its exercise");
  assert.match(JSON.stringify(ws.getPage(ex.id)?.content), /Quiz/, "with its code (the row's page)");
  assert.notEqual(ex.id, w);
  // (Marked as Learn's again, but this one may go to the trash.)
  assert.equal(ws.getDatabase(copy!.steps)?.schema.owner?.plugin, "learn");
  ws.archivePage(rootId);
  assert.equal(dbs.learnSpaceAt(rootId), null, "trashed: no space any more");
  assert.throws(() => ws.archivePage(dbs.learnDbs().folder), /Learn/, "the first space stays");
});
