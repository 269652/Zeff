import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * Learn inside the Workspace: a row of Courses shows the course, a row of Steps the topic or the lesson — each from the row
 * itself, their links staying in the Workspace; every Learn database has its own view (Learn's parts and the new blocks), added
 * once; the view's actions read the space's courses, a map whose steps open their rows, the cards due.
 */

let seeded: Promise<{ course: number }> | null = null;
/** One demo course for the file's tests. */
async function setup() {
  seeded ??= (async () => {
    const { setInstalled } = await import("@/plugins/state");
    setInstalled("workspace", true);
    setInstalled("learn", true);
    await import("@/plugins/learn/server");
    const { seedLearnDemo } = await import("@/plugins/learn/demo");
    return { course: seedLearnDemo("en") };
  })();
  return seeded;
}

test("a row of Learn's databases is told apart: course, topic, lesson", async () => {
  const { course } = await setup();
  const store = await import("@/plugins/learn/store");
  const nodes = store.courseNodes(course);
  const skill = nodes.find((n) => n.kind === "skill")!;
  const step = nodes.find((n) => n.key === "plane.c")!;
  assert.deepEqual(store.nodeOfRow(step.id), { courseId: course, key: "plane.c" });
  assert.equal(store.nodeOfRow(skill.id)?.key, skill.key);
  assert.equal(store.nodeOfRow(course), null, "a course is no node");
  const { pageApp } = await import("@/plugins/workspace/page-apps");
  assert.ok(await pageApp(course), "its screen on the course's row");
  assert.ok(await pageApp(skill.id), "the topic");
  // (The lesson's screen pulls in a stylesheet Node can't read: it was checked in the browser.)
  const other = (await import("@/plugins/workspace/store")).createPage({ title: "Plain" });
  assert.equal(await pageApp(other), null, "any other page: none");
});

test("each of Learn's databases has its own view, once — and it is an available app view", async () => {
  const { course } = await setup();
  const { learnSpaces } = await import("@/plugins/learn/dbs");
  const space = learnSpaces()[0];
  const { getDatabase } = await import("@/plugins/workspace/store");
  for (const w of ["courses", "steps", "exercises", "activity", "cards", "messages"] as const) {
    const views = getDatabase(space[w])!.schema.views;
    assert.equal(views.filter((v) => v.app === "learn").length, 1, `${w}: one Learn view`);
    assert.equal(views[0].app, "learn", `${w}: first`);
    assert.ok(views.some((v) => v.type === "table"), `${w}: its table stays`);
  }
  const { appViewsFor } = await import("@/plugins/workspace/app-views");
  assert.deepEqual(appViewsFor(undefined, "learn").map((a) => a.id), ["learn"]);
  assert.deepEqual(appViewsFor(undefined, "someone").map((a) => a.id), []);
  void course;
  // A template that draws: every database's, on its rows, without a mistake.
  const { renderView } = await import("@/plugins/workspace/view-template");
  const { LEARN_VIEW } = await import("@/plugins/learn/view-template.meta");
  for (const w of ["courses", "steps", "exercises", "activity", "cards", "messages"] as const) {
    const d = getDatabase(space[w])!;
    const rows = (await import("@/plugins/workspace/store")).rowsOf(space[w])?.rows ?? [];
    const v = d.schema.views.find((x) => x.app === "learn")!;
    const r = renderView(v.template!, { rows, props: d.schema.properties, titleName: d.schema.titleName, state: {}, app: { courses: [], courseOptions: "1:A", firstCourse: "1", due: 0 }, db: { id: d.page.id, title: d.page.title } }, { parts: LEARN_VIEW.parts, actions: LEARN_VIEW.actions });
    assert.deepEqual(r.errors, [], `${w}: ${JSON.stringify(r.errors)}`);
  }
});

test("the view's actions: the space's courses, a map with steps opening their rows, the cards due", async () => {
  const { course } = await setup();
  const { learnSpaces } = await import("@/plugins/learn/dbs");
  const space = learnSpaces()[0];
  const a = await import("@/plugins/learn/view-actions");
  const data = await a.learnViewDataAction(space.courses);
  assert.ok(data.ok);
  if (data.ok) {
    assert.deepEqual(data.courses.map((c) => c.id), [course]);
    assert.match(data.courseOptions, new RegExp(`^${course}:`));
    assert.equal(data.firstCourse, String(course));
  }
  const map = await a.learnMapAction(course);
  assert.ok(map.ok && map.map);
  if (map.ok && map.map) {
    const hrefs = map.map.nodes.flatMap((n) => n.steps.map((s) => s.href));
    assert.ok(hrefs.length > 5 && hrefs.every((h) => /^\/workspace\/\d+$/.test(h ?? "")), "every step opens its row in the Workspace");
  }
  const due = await a.learnDueCardsAction(space.cards, course);
  assert.ok(due.ok && due.cards.length > 0 && Object.keys(due.cards[0]).sort().join() === "back,front,id");
});
