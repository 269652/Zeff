import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** The demo's lesson (a course a week in, a lesson with a run whose log has the talk) — its course, step and todo. */
async function lesson() {
  const { seedLearnDemo } = await import("@/plugins/learn/demo");
  const store = await import("@/plugins/learn/store");
  const conv = await import("@/plugins/learn/conversation");
  const dbs = await import("@/plugins/learn/dbs");
  const ws = await import("@/plugins/workspace/store");
  await import("@/plugins/learn/teacher"); // (the lesson's guard registered)
  const id = seedLearnDemo("en");
  const node = store.getNode(id, "plane.c")!;
  return { store, conv, dbs, ws, id, node, todoId: node.lessonTodoId! };
}

test("a lesson's conversation is written into Conversations — one row per message, each once, linked to the course and the step", async () => {
  const { conv, dbs, ws, id, node, todoId } = await lesson();
  const added = conv.syncLesson(todoId);
  assert.ok(added >= 10, `the talk written (${added})`);
  assert.equal(conv.syncLesson(todoId), 0, "read again: nothing twice");
  const msgs = conv.stepMessages(node.id);
  assert.equal(msgs[0].role, "you", "the run's first message: what started it");
  assert.match(msgs[0].text, /^Let's begin/);
  assert.ok(msgs.some((m) => m.role === "teacher" && /how much a curve bends/.test(m.text)));
  const shown = msgs.filter((m) => m.kind === "exercise");
  assert.equal(shown.length, 2, "both exercises shown");
  assert.deepEqual(shown.map((m) => m.text), ["Curvature of circles", "The osculating circle"]);
  assert.ok(shown.every((m) => m.exercise), "each linked to its exercise's row");
  const row = ws.rawRows(dbs.learnDbs().messages).find((r) => r.id === msgs[0].id)!;
  assert.deepEqual(row.cells[dbs.P.course], [id]);
  assert.deepEqual(row.cells[dbs.P.step], [node.id]);
  assert.equal(conv.lessonChanged(todoId), false, "nothing changed by you: the session goes on");
});

test("a message deleted or edited in the database: gone from the lesson for good, and the next message starts a fresh session that is told the stored conversation", async () => {
  const { conv, ws, node, todoId } = await lesson();
  conv.syncLesson(todoId);
  const msgs = conv.stepMessages(node.id);
  const wrong = msgs.find((m) => m.role === "teacher" && /Two out of three/.test(m.text))!;
  ws.archivePage(wrong.id);
  const edited = msgs.find((m) => m.role === "you" && /isn't a circle/.test(m.text))!;
  ws.setCell(edited.id, (await import("@/plugins/learn/dbs")).P.text, "And for an ellipse?");
  assert.equal(conv.syncLesson(todoId), 0, "the log isn't read in again: what you deleted stays deleted");
  assert.ok(!conv.stepMessages(node.id).some((m) => m.id === wrong.id));
  assert.equal(conv.lessonChanged(todoId), true, "changed since the session last spoke");
  const c = conv.lessonContinuity(todoId);
  assert.equal(c.fresh, true);
  const context = (c as { context: string }).context;
  assert.match(context, /And for an ellipse\?/, "the conversation as stored now");
  assert.doesNotMatch(context, /Two out of three/, "not what was deleted");
  assert.doesNotMatch(context, /isn't a circle/, "not what was edited away");
  // The guard the runner asks (conversation-guard.ts): the same answer; once the fresh session began, the lesson is as it knows it.
  const guard = await import("@/lib/work/conversation-guard");
  assert.match(guard.freshContext(todoId) ?? "", /And for an ellipse\?/);
  conv.freshSessionStarted(todoId);
  assert.equal(conv.lessonChanged(todoId), false);
  assert.equal(guard.freshContext(todoId), null, "then it goes on in that session");
});

test("the timeline is built from the stored messages — an edited message shows as edited, a deleted one not at all", async () => {
  const { conv, ws, store, id, node, todoId } = await lesson();
  const { buildTimeline, runLines } = await import("@/plugins/learn/timeline");
  const { runsForTodos } = await import("@/lib/work/store");
  conv.syncLesson(todoId);
  const say = conv.stepMessages(node.id).find((m) => m.role === "teacher" && /All right/.test(m.text))!;
  ws.archivePage(say.id);
  const runs = runsForTodos([todoId]).get(todoId)!;
  const states = conv.syncStates(runs.map((r) => r.id));
  const stored = conv.stepMessages(node.id);
  const items = buildTimeline({
    runs: runs.map((r) => ({ id: r.id, startedAt: r.startedAt!, prompts: [], lines: runLines(stored.filter((m) => m.run === r.id), [], states.get(r.id)!.lines) })),
    widgets: store.nodeWidgets(id, "plane.c").map((w) => ({ id: w.id, title: w.title, createdAt: w.createdAt })),
    results: store.widgetResults(id, "plane.c"),
  });
  assert.ok(!items.some((i) => i.kind === "say" && /All right/.test(i.text)), "deleted: not shown");
  assert.equal(items.filter((i) => i.kind === "widget").length, 2, "the exercises where they were shown");
  assert.equal(items.filter((i) => i.kind === "result").length, 3, "with their results");
  assert.match(items[1].kind === "you" ? items[1].text : "", /^Let's begin/);
});

test("the runner: a lesson changed in the database starts a fresh session with the stored conversation; an unchanged one resumes", async () => {
  const { conv, ws, node, todoId } = await lesson();
  const { setInstalled } = await import("@/plugins/state");
  for (const p of ["work", "llm", "claude-cli"] as const) setInstalled(p, true);
  const { getRun, updateRun, runsForTodos } = await import("@/lib/work/store");
  const { logPath } = await import("@/lib/work/log");
  const { dispatchTodo } = await import("@/lib/work/runner");
  // The demo's run as a real one: its session, the folder it ran in, its log starting the session.
  const old = runsForTodos([todoId]).get(todoId)![0];
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-lesson-"));
  updateRun(old.id, { sessionId: "old-session", cwd });
  fs.writeFileSync(logPath(old.id), `${JSON.stringify({ type: "system", subtype: "init", session_id: "old-session", cwd })}\n${fs.readFileSync(logPath(old.id), "utf8")}`);
  conv.syncLesson(todoId);
  const settle = async (id: number) => {
    for (let i = 0; i < 100 && getRun(id)?.status === "queued"; i++) await new Promise((r) => setTimeout(r, 50));
    for (let i = 0; i < 100 && getRun(id)?.prompt === getRun(id)?.prompt && !getRun(id)?.startedAt; i++) await new Promise((r) => setTimeout(r, 50));
  };

  // Unchanged: the next message resumes the session.
  const same = dispatchTodo(todoId, { instruction: "Go on", continueRun: old.id, conversation: true, session: { permissionMode: "default" } });
  await settle(same.id);
  assert.equal(getRun(same.id)!.sessionId, "old-session", "resumed");
  assert.equal(getRun(same.id)!.prompt, "Go on", "just your words");
  for (let i = 0; i < 100 && ["queued", "running"].includes(getRun(same.id)!.status); i++) await new Promise((r) => setTimeout(r, 50));
  updateRun(same.id, { status: "done", sessionId: null, finishedAt: new Date().toISOString() });

  // A message deleted in the database: the next run starts afresh, its prompt carries the stored conversation.
  const msg = conv.stepMessages(node.id).find((m) => m.role === "teacher" && /Two out of three/.test(m.text))!;
  ws.archivePage(msg.id);
  const fresh = dispatchTodo(todoId, { instruction: "What about an ellipse?", continueRun: old.id, conversation: true, session: { permissionMode: "default" } });
  await settle(fresh.id);
  const r = getRun(fresh.id)!;
  assert.notEqual(r.sessionId, "old-session", "not the old session");
  assert.match(r.prompt, /Zeffs Datenbank/, "told the conversation from the database");
  assert.match(r.prompt, /What about an ellipse\?$/, "and then your message");
  assert.doesNotMatch(r.prompt, /Two out of three/);
  assert.equal(conv.lessonChanged(todoId), false, "from now on the session knows the conversation");
});
