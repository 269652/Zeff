import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const plan = {
  title: "Differential geometry",
  summary: "From curves to surfaces.",
  years: 1,
  sources: [{ id: "s1", title: "do Carmo, Differential Geometry of Curves and Surfaces", year: 1976 }],
  nodes: [
    { key: "y1", kind: "year", parent: null, title: "Year 1" },
    { key: "p1", kind: "phase", parent: "y1", title: "Curves" },
    { key: "a", kind: "skill", parent: "p1", title: "Curvature", path: "Core" },
    { key: "a1", kind: "step", parent: "a", title: "Arc length", sources: ["s1"] },
    { key: "a2", kind: "step", parent: "a", title: "Frenet frame", requires: ["a1"] },
  ],
};

async function course() {
  const store = await import("@/plugins/learn/store");
  const id = store.createCourse({ topic: "Differentialgeometrie", goal: "Riemannsche Geometrie verstehen", level: "Abitur" });
  store.savePlan(id, plan);
  return { store, id };
}

test("a course: made while researching, ready with its plan — the nodes stored in the plan's order", async () => {
  const store = await import("@/plugins/learn/store");
  const id = store.createCourse({ topic: "Französisch", goal: "B2", level: "A1" });
  assert.equal(store.getCourse(id)?.status, "researching");
  store.savePlan(id, plan);
  const c = store.getCourse(id)!;
  assert.equal(c.status, "ready");
  assert.equal(c.title, "Differential geometry");
  assert.deepEqual(store.courseNodes(id).map((n) => n.key), ["y1", "p1", "a", "a1", "a2"]);
  assert.deepEqual(store.courseNodes(id).find((n) => n.key === "a1")?.sources, ["s1"]);
  assert.equal(c.sources.length, 1);
});

test("research failed: the course says why", async () => {
  const store = await import("@/plugins/learn/store");
  const id = store.createCourse({ topic: "x", goal: "", level: "" });
  store.failResearch(id, "The AI didn't answer.");
  assert.equal(store.getCourse(id)?.status, "failed");
  assert.equal(store.getCourse(id)?.error, "The AI didn't answer.");
});

test("mastering a step: its xp, once; mastering the last step of a skill gives the skill's xp too", async () => {
  const { store, id } = await course();
  const r1 = store.masterNode(id, "a1", new Date("2026-11-08T10:00:00Z"));
  assert.equal(r1.xp, 10);
  assert.deepEqual(r1.mastered, ["a1"]);
  const again = store.masterNode(id, "a1", new Date("2026-11-08T10:05:00Z"));
  assert.equal(again.xp, 0, "no xp twice");
  const r2 = store.masterNode(id, "a2", new Date("2026-11-08T11:00:00Z"));
  assert.deepEqual(r2.mastered.sort(), ["a", "a2", "p1", "y1"].sort(), "the skill, its phase and year were completed with it");
  assert.equal(r2.xp, 10 + 50 + 150 + 500);
  const c = store.getCourse(id)!;
  assert.equal(c.xp, 10 + r2.xp);
  assert.equal(c.todayXp, c.xp, "all on one day");
  assert.equal(c.streak, 1);
  assert.ok(c.badges.includes("first-step") && c.badges.includes("first-skill") && c.badges.includes("course-done"));
});

test("a step that's locked can't be mastered", async () => {
  const { store, id } = await course();
  assert.throws(() => store.masterNode(id, "a2", new Date()), /locked/i);
});

test("streak and today's xp follow the days", async () => {
  const { store, id } = await course();
  store.masterNode(id, "a1", new Date("2026-11-08T10:00:00Z"));
  store.awardXp(id, 5, "bonus", {}, new Date("2026-11-09T09:00:00Z"));
  const c = store.getCourse(id)!;
  assert.equal(c.streak, 2);
  assert.equal(c.todayXp, 5, "a new day starts at 0");
  assert.equal(c.today, "2026-11-09");
});

test("the tree of a course: statuses from what's mastered and what's active", async () => {
  const { store, id } = await course();
  store.startNode(id, "a1");
  let t = store.courseTree(id);
  assert.equal(t.tree.status.get("a1"), "active");
  store.masterNode(id, "a1", new Date());
  t = store.courseTree(id);
  assert.equal(t.tree.status.get("a1"), "mastered");
  assert.equal(t.tree.status.get("a2"), "available");
});

test("widgets: stored with their node; a result gives xp for doing better only", async () => {
  const { store, id } = await course();
  const w = store.addWidget({ courseId: id, nodeKey: "a1", title: "Arc length quiz", html: "<p>quiz</p>", libs: ["katex"] });
  assert.equal(store.getWidget(w)?.title, "Arc length quiz");
  assert.deepEqual(store.getWidget(w)?.libs, ["katex"]);
  assert.equal(store.widgetResult(w, { type: "result", score: 0.6 }, new Date()).xp, 3);
  assert.equal(store.widgetResult(w, { type: "result", score: 0.4 }, new Date()).xp, 0, "worse: nothing");
  assert.equal(store.widgetResult(w, { type: "result", score: 1 }, new Date()).xp, 2, "up to 5 in all");
  assert.equal(store.nodeWidgets(id, "a1").length, 1);
  assert.throws(() => store.addWidget({ courseId: id, nodeKey: "a1", title: "x", html: '<base href="https://evil.example">' }), /base/);
});

test("cards: added with their node, due at once, reviewed into the future; a review is worth a point", async () => {
  const { store, id } = await course();
  const now = new Date("2026-11-08T10:00:00Z");
  store.addCards(id, "a1", [{ front: "Arc length of r(t)?", back: "∫|r'(t)| dt" }, { front: "", back: "x" }], now);
  assert.equal(store.dueCards(id, now).length, 1, "a card needs a front and a back");
  const card = store.dueCards(id, now)[0];
  const r = store.reviewCard(card.id, "good", now);
  assert.equal(r.xp, 1);
  assert.equal(store.dueCards(id, now).length, 0);
  assert.equal(store.dueCards(id, new Date("2026-11-09T10:00:00Z")).length, 1);
  assert.equal(store.dueCount(new Date("2026-11-09T10:00:00Z")).find((d) => d.courseId === id)?.due, 1);
});

test("interests steer the next steps", async () => {
  const { store, id } = await course();
  store.setInterests(id, { Core: 5 });
  assert.deepEqual(store.getCourse(id)?.interests, { Core: 5 });
  assert.equal(store.nextCourseSteps(id)[0]?.key, "a1");
});

test("a course can be deleted with all it has", async () => {
  const { store, id } = await course();
  store.addCards(id, "a1", [{ front: "f", back: "b" }], new Date());
  store.deleteCourse(id);
  assert.equal(store.getCourse(id), undefined);
  assert.equal(store.courseNodes(id).length, 0);
});
