import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** Todos a worker makes are its own: off your lists, on the Worker tab, closed by the worker. */
test("worker todos stay out of your lists and a worker closes them itself", async () => {
  const { addFollowUp, boardTodos, doneTodos, getTodo, markWorkerDone, workerTodos } = await import("@/lib/todos/store");
  const mine = addFollowUp({ ticket: "ABC-1", text: "Yours", kind: "other", parentId: null, workRunId: null, source: "test" });
  const theirs = addFollowUp({ ticket: "ABC-1", text: "Worker's", kind: "comment", parentId: null, workRunId: 1, source: "test", byWorker: true });
  assert.equal(getTodo(theirs.id)!.byWorker, true);
  assert.deepEqual(boardTodos(["ABC-1"]).map((t) => t.id), [mine.id]);
  assert.deepEqual(workerTodos().map((t) => t.id), [theirs.id]);

  // A worker reports its own todo done: closed, no waiting for you; yours stays open and marked.
  markWorkerDone(theirs.id, "W-1", "fertig");
  assert.equal(getTodo(theirs.id)!.status, "done");
  markWorkerDone(mine.id, "W-1", "fertig");
  assert.equal(getTodo(mine.id)!.status, "open");
  assert.ok(getTodo(mine.id)!.workerDone);
  assert.deepEqual(doneTodos().map((t) => t.id), []);
  assert.deepEqual(workerTodos().map((t) => t.id), [theirs.id]);
});

test("worker todos are quiet: no activity, no unread news", async () => {
  const { addFollowUp, setTodoStatus } = await import("@/lib/todos/store");
  const { activityNewsIds, todoActivity } = await import("@/lib/todos/activity");
  const mine = addFollowUp({ ticket: "QUI-1", text: "Yours", kind: "other", parentId: null, workRunId: null, source: "test" });
  const theirs = addFollowUp({ ticket: "QUI-1", text: "Worker's", kind: "other", parentId: null, workRunId: 3, source: "test", byWorker: true });
  setTodoStatus(theirs.id, "done");
  setTodoStatus(mine.id, "done");
  const ids = new Set(todoActivity().map((e) => e.todoId));
  assert.ok(ids.has(mine.id), "yours show in the activity");
  assert.ok(!ids.has(theirs.id), "the worker's don't");
  const news = new Set(activityNewsIds());
  // (Their events carry no weight: nothing of the worker's todo is in the news ids either.)
  assert.ok(!todoActivity({ limit: 400 }).some((e) => e.todoId === theirs.id));
  assert.ok(news.size > 0, "yours still count as news (made by a worker or Zeff, not by you)");
});
