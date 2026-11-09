import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

test("the Learn demo: a branched course a week in — foundations mastered, a streak, badges, a lesson with exercises, tries and talk, cards due", async () => {
  const { seedLearnDemo } = await import("@/plugins/learn/demo");
  const store = await import("@/plugins/learn/store");
  const { buildTimeline } = await import("@/plugins/learn/timeline");
  const { readLog } = await import("@/lib/work/log");
  const { runsForTodos } = await import("@/lib/work/store");
  const { getTodo } = await import("@/lib/todos/store");
  const { isInstalled } = await import("@/plugins/state");

  const id = seedLearnDemo("en");
  assert.equal(isInstalled("learn"), true);
  const c = store.getCourse(id)!;
  assert.equal(c.status, "ready");
  assert.equal(c.title, "Differential geometry: from curves to surfaces");
  assert.ok(c.streak >= 7, `a week's streak (${c.streak})`);
  for (const b of ["first-step", "first-skill", "first-phase"]) assert.ok(c.badges.includes(b as never), b);

  const { tree } = store.courseTree(id);
  assert.equal(tree.status.get("p1"), "mastered", "the foundations done");
  assert.equal(tree.status.get("plane.c"), "active", "the lesson under way");
  assert.equal(tree.status.get("egregium.a"), "locked");
  assert.ok(new Set([...tree.paths.keys()]).size >= 4, "several paths — a tree, not a chain");

  const node = store.getNode(id, "plane.c")!;
  const runs = runsForTodos([node.lessonTodoId!]).get(node.lessonTodoId!) ?? [];
  assert.equal(runs.length, 1);
  const todo = getTodo(node.lessonTodoId!)!;
  const items = buildTimeline({
    runs: runs.map((r) => ({ id: r.id, startedAt: r.startedAt!, prompts: todo.userNotes.filter((n) => n.kind === "instruction" && n.run === r.id).map((n) => n.text), lines: readLog(r.id).lines })),
    widgets: store.nodeWidgets(id, "plane.c").map((w) => ({ id: w.id, title: w.title, createdAt: w.createdAt })),
    results: store.widgetResults(id, "plane.c"),
  });
  const kinds = items.map((i) => i.kind);
  assert.equal(kinds.filter((k) => k === "widget").length, 2);
  assert.equal(kinds.filter((k) => k === "result").length, 3);
  assert.ok(kinds.filter((k) => k === "say").length >= 5);
  const firstTry = items.find((i) => i.kind === "result") as { answers?: { ok?: boolean }[] };
  assert.deepEqual(firstTry.answers?.map((a) => a.ok), [true, true, false], "the first try with its wrong answer");
  assert.ok(store.dueCards(id).length >= 4, "cards to review");
});
