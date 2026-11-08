import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const plan = {
  title: "Differentialgeometrie",
  summary: "Kurven und Flächen.",
  years: 1,
  sources: [{ id: "s1", title: "do Carmo", url: "https://example.org/docarmo" }],
  nodes: [
    { key: "k", kind: "skill", parent: null, title: "Kurven", path: "Grundlagen" },
    { key: "k1", kind: "step", parent: "k", title: "Bogenlänge", objectives: ["die Bogenlänge einer Kurve berechnen"], sources: ["s1"] },
    { key: "k2", kind: "step", parent: "k", title: "Frenet-Rahmen", requires: ["k1"] },
  ],
};

async function setup() {
  const store = await import("@/plugins/learn/store");
  const id = store.createCourse({ topic: "Differentialgeometrie", goal: "Riemannsche Geometrie", level: "Analysis I" });
  store.savePlan(id, plan);
  return { store, id };
}

test("the teacher's rules: the course, the step, its objectives and sources, how to teach, the widget libraries, the ids for its tools", async () => {
  const { id } = await setup();
  const { teacherRules } = await import("@/plugins/learn/teacher");
  const store = await import("@/plugins/learn/store");
  const rules = teacherRules(store.getCourse(id)!, store.getNode(id, "k1")!, "PREAMBLE");
  for (const s of ["Differentialgeometrie", "Bogenlänge", "die Bogenlänge einer Kurve berechnen", "do Carmo", "learn_widget", "learn_master_step", "learn_add_cards", "katex", "jsxgraph", `course_id ${id}`, 'node_key "k1"', "PREAMBLE"]) {
    assert.ok(rules.includes(s), `rules mention ${s}`);
  }
});

test("the lesson's chat profile: the teacher's rules, Zeff's tools and the learn tools — found by the lesson's todo", async () => {
  const { store, id } = await setup();
  const teacher = await import("@/plugins/learn/teacher");
  const todoId = teacher.addLessonTodo(id, "k1");
  const { chatProfileFor, isChatTodo } = await import("@/lib/chat");
  const { getTodo } = await import("@/lib/todos/store");
  const todo = getTodo(todoId)!;
  assert.equal(isChatTodo(todo), true);
  assert.equal(todo.byWorker, true, "a lesson's todo isn't in your list");
  assert.equal(store.getNode(id, "k1")?.lessonTodoId, todoId);
  const p = chatProfileFor(todo, "");
  assert.match(p.rules, /Bogenlänge/);
  for (const t of ["mcp__zeff__learn_widget", "mcp__zeff__learn_master_step", "mcp__zeff__learn_add_cards", "mcp__zeff__learn_context", "mcp__zeff__add_todo"]) assert.ok(p.allowedTools.includes(t), t);
  assert.ok(p.disallowedTools.includes("Bash"));
});

test("tools: a widget is stored for the step and shown; html that can't be shown is refused with why", async () => {
  const { store, id } = await setup();
  const tools = await import("@/plugins/learn/tools");
  const out = tools.learnWidget({ course_id: id, node_key: "k1", title: "Bogenlänge üben", html: "<div>quiz</div>", libs: ["katex", "nope"] });
  assert.match(out, /shown/i);
  const w = store.nodeWidgets(id, "k1");
  assert.equal(w.length, 1);
  assert.deepEqual(w[0].libs, ["katex"]);
  assert.throws(() => tools.learnWidget({ course_id: id, node_key: "k1", title: "x", html: '<base href="https://evil.example">' }), /base/);
  assert.throws(() => tools.learnWidget({ course_id: id, node_key: "nope", title: "x", html: "<p>x</p>" }), /no step/i);
});

test("tools: master a step (xp, what it completed), add cards, context and progress as text", async () => {
  const { store, id } = await setup();
  const tools = await import("@/plugins/learn/tools");
  assert.match(tools.learnMasterStep({ course_id: id, node_key: "k1", evidence: "3 von 3 Aufgaben richtig" }), /\+10 XP/);
  assert.equal(store.courseTree(id).tree.status.get("k2"), "available");
  assert.match(tools.learnAddCards({ course_id: id, node_key: "k1", cards: [{ front: "Bogenlänge von r?", back: "∫|r'|dt" }] }), /1 card/);
  const ctx = tools.learnContext({ course_id: id, node_key: "k2" });
  assert.match(ctx, /Frenet-Rahmen/);
  assert.match(ctx, /Bogenlänge/, "what came before (mastered) is listed");
  const prog = tools.learnProgress({ course_id: id });
  assert.match(prog, /Level 1/);
  assert.match(prog, /Frenet-Rahmen/, "the next step");
  assert.throws(() => tools.learnMasterStep({ course_id: 999, node_key: "k1" }), /course/i);
});
