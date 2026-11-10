import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const plan = {
  title: "Differential geometry",
  summary: "From curves to surfaces.",
  years: 1,
  sources: [{ id: "s1", title: "do Carmo", year: 1976 }],
  nodes: [
    { key: "y1", kind: "year", parent: null, title: "Year 1" },
    { key: "p1", kind: "phase", parent: "y1", title: "Curves" },
    { key: "a", kind: "skill", parent: "p1", title: "Curvature", path: "Core" },
    { key: "a1", kind: "step", parent: "a", title: "Arc length", sources: ["s1"], objectives: ["Compute the length of a curve", "Reparametrize by arc length"] },
    { key: "a2", kind: "step", parent: "a", title: "Frenet frame", requires: ["a1"] },
  ],
};

async function setup() {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("learn", true);
  setInstalled("workspace", true);
  const store = await import("@/plugins/learn/store");
  const dbs = await import("@/plugins/learn/dbs");
  const ws = await import("@/plugins/workspace/store");
  const id = store.createCourse({ topic: "Differentialgeometrie", goal: "Riemann", level: "Abitur" });
  store.savePlan(id, plan);
  return { store, dbs, ws, id };
}

test("Learn's databases: a folder with Courses, Steps, Exercises, Activity, Cards and Conversations — made once, marked as the plugin's", async () => {
  const { dbs, ws } = await setup();
  const a = dbs.learnDbs();
  const again = dbs.ensureLearnDatabases();
  assert.deepEqual(again, a, "made once");
  for (const k of ["courses", "steps", "exercises", "activity", "cards", "messages"] as const) {
    const d = ws.getDatabase(a[k])!;
    assert.ok(d, k);
    assert.equal(d.page.parentId, a.folder, `${k} sits in the Learn folder`);
    assert.equal(d.schema.owner?.plugin, "learn");
    assert.ok(d.schema.properties.every((p) => !p.id.startsWith("learn") || d.schema.owner!.props.includes(p.id)), `${k}: its properties are the plugin's`);
  }
  const steps = ws.getDatabase(a.steps)!.schema;
  assert.equal(steps.properties.find((p) => p.id === dbs.P.course)?.relationDb, a.courses, "a step links to its course");
  assert.equal(steps.properties.find((p) => p.id === dbs.P.parent)?.relationDb, a.steps, "and to its parent step");
  assert.notEqual(steps.dayList, true, "not a daily list (nothing unticked at night)");
});

test("the plugin's properties can't be removed or retyped, the databases not trashed; your own properties and views are fine", async () => {
  const { dbs, ws } = await setup();
  const a = dbs.learnDbs();
  const cur = ws.getDatabase(a.steps)!.schema;
  assert.throws(() => ws.updateSchema(a.steps, { ...cur, properties: cur.properties.filter((p) => p.id !== dbs.P.mastered) }), /Learn/);
  assert.throws(() => ws.updateSchema(a.steps, { ...cur, properties: cur.properties.map((p) => (p.id === dbs.P.mastered ? { ...p, type: "text" } : p)) }), /Learn/);
  const renamed = ws.updateSchema(a.steps, { ...cur, properties: [...cur.properties.map((p) => (p.id === dbs.P.mastered ? { ...p, name: "Gemeistert" } : p)), { id: "mine", name: "My note", type: "text" }] });
  assert.ok(renamed.properties.some((p) => p.id === "mine"), "an own property added");
  assert.equal(renamed.properties.find((p) => p.id === dbs.P.mastered)?.name, "Gemeistert", "renamed is fine");
  assert.equal(renamed.owner?.plugin, "learn", "the mark stays");
  // A schema saved without the mark (a view edited somewhere) keeps it.
  const { owner: _o, ...bare } = ws.getDatabase(a.steps)!.schema;
  void _o;
  assert.equal(ws.updateSchema(a.steps, bare).owner?.plugin, "learn");
  assert.throws(() => ws.archivePage(a.steps), /Learn/);
  assert.throws(() => ws.archivePage(a.folder), /Learn/, "nor the folder with them");
  assert.throws(() => ws.deletePage(a.cards), /Learn/);
  // A copy is yours.
  const copy = ws.duplicatePage(a.cards, { parentId: null });
  assert.equal(ws.getDatabase(copy)?.schema.owner, undefined);
});

test("a course and its plan are rows: the course in Courses, each node in Steps linked to it and to its parent", async () => {
  const { dbs, ws, id, store } = await setup();
  const a = dbs.learnDbs();
  const course = ws.rawRows(a.courses).find((r) => r.id === id)!;
  assert.equal(course.title, "Differential geometry");
  assert.equal(course.cells[dbs.P.topic], "Differentialgeometrie");
  assert.equal(course.cells[dbs.P.status], "ready");
  const steps = ws.rawRows(a.steps).filter((r) => (r.cells[dbs.P.course] as number[])?.includes(id));
  assert.deepEqual(steps.map((r) => r.cells[dbs.P.key]).sort(), ["a", "a1", "a2", "p1", "y1"]);
  const a1 = steps.find((r) => r.cells[dbs.P.key] === "a1")!;
  const skill = steps.find((r) => r.cells[dbs.P.key] === "a")!;
  assert.deepEqual(a1.cells[dbs.P.parent], [skill.id]);
  assert.deepEqual(steps.find((r) => r.cells[dbs.P.key] === "a2")!.cells[dbs.P.requires], [a1.id]);
  assert.deepEqual(store.getNode(id, "a1")?.objectives, ["Compute the length of a curve", "Reparametrize by arc length"]);
  assert.equal(store.getNode(id, "a1")?.id, a1.id, "a node's id is its row's");
});

test("edits in the databases take effect: a step ticked mastered, a title changed, a card's due date moved", async () => {
  const { dbs, ws, id, store } = await setup();
  const a = dbs.learnDbs();
  const row = (k: string) => ws.rawRows(a.steps).find((r) => (r.cells[dbs.P.course] as number[])?.includes(id) && r.cells[dbs.P.key] === k)!;
  assert.equal(store.courseTree(id).tree.status.get("a1"), "available");
  ws.setCell(row("a1").id, dbs.P.mastered, true);
  assert.equal(store.courseTree(id).tree.status.get("a1"), "mastered", "ticked in the database: mastered on the skill map");
  assert.equal(store.courseTree(id).tree.status.get("a2"), "available", "and what it unlocks opens");
  ws.setCell(row("a2").id, "title", "Das Frenet-Dreibein");
  assert.equal(store.getNode(id, "a2")?.title, "Das Frenet-Dreibein");
  ws.setCell(row("a1").id, dbs.P.mastered, false);
  assert.equal(store.courseTree(id).tree.status.get("a1"), "available", "unticked: not mastered any more");
  // A course's goal edited in the table.
  ws.setCell(id, dbs.P.goal, "Allgemeine Relativitätstheorie");
  assert.equal(store.getCourse(id)?.goal, "Allgemeine Relativitätstheorie");
  // A card due later.
  const now = new Date("2026-11-08T10:00:00Z");
  store.addCards(id, "a1", [{ front: "Bogenlänge?", back: "∫|c'(t)|dt" }], now);
  assert.equal(store.dueCards(id, now).length, 1);
  const card = ws.rawRows(a.cards).find((r) => r.title === "Bogenlänge?")!;
  ws.setCell(card.id, dbs.P.due, "2026-12-01T09:00");
  assert.equal(store.dueCards(id, now).length, 0, "moved in the database: not due now");
  // A step's row deleted: gone from the plan.
  ws.archivePage(row("a2").id);
  assert.equal(store.getNode(id, "a2"), undefined);
});

test("a page reads each database once, not once per node (the rows are kept until something changes)", async () => {
  const { dbs, id, store, ws } = await setup();
  const one = dbs.learnRows("steps");
  store.courseTree(id);
  store.nextCourseSteps(id, 5);
  assert.equal(dbs.learnRows("steps"), one, "the same rows — not read again");
  ws.setCell(store.getNode(id, "a1")!.id, dbs.P.mastered, true);
  assert.notEqual(dbs.learnRows("steps"), one, "a change: read again");
});

test("a course deleted: its rows go to the Workspace's trash (they can come back)", async () => {
  const { dbs, ws, id, store } = await setup();
  store.addCards(id, "a1", [{ front: "f", back: "b" }]);
  store.deleteCourse(id);
  assert.equal(store.getCourse(id), undefined);
  const a = dbs.learnDbs();
  assert.equal(ws.rawRows(a.steps).filter((r) => (r.cells[dbs.P.course] as number[])?.includes(id)).length, 0);
  assert.ok(ws.getPage(id)?.archivedAt, "the course's row is in the trash");
});
