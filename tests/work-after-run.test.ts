import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** A message sent while the worker still works waits for that run; stopping the run takes it back. */
test("a reply queued behind a run is cancelled with it", async () => {
  const { createRun, getRun } = await import("@/lib/work/store");
  const { cancelRun } = await import("@/lib/work/runner");
  const base = { ticket: "ABC-1", todoId: 9001, mode: "instruct", provider: "claude", model: null, permissionMode: null, repo: null };
  const first = createRun({ ...base, prompt: "one" });
  const reply = createRun({ ...base, prompt: "two", afterRun: first.id });
  assert.equal(getRun(reply.id)!.afterRun, first.id);
  cancelRun(first.id);
  assert.equal(getRun(first.id)!.status, "cancelled");
  assert.equal(getRun(reply.id)!.status, "cancelled");
});

test("messages sent while the worker is busy are collected into one run", async () => {
  const { addFollowUp, getTodo } = await import("@/lib/todos/store");
  const { createRun, getRun, runsForTodos, updateRun } = await import("@/lib/work/store");
  const { dispatchTodo } = await import("@/lib/work/runner");
  const todo = addFollowUp({ ticket: "ABC-2", text: "Talk", kind: "other", parentId: null, workRunId: null, source: "test" });
  const base = { ticket: "ABC-2", todoId: todo.id, mode: "instruct", provider: "claude", model: null, permissionMode: null, repo: null };
  const first = createRun({ ...base, prompt: "one" });
  updateRun(first.id, { status: "running" }); // (a worker busy: the queue pump has nothing of it to start)
  const waiting = createRun({ ...base, prompt: "## Deine Anweisung (vom Nutzer — sie geht vor)\nA", afterRun: first.id });
  dispatchTodo(todo.id, { continueRun: waiting.id, instruction: "B" });
  dispatchTodo(todo.id, { continueRun: waiting.id, instruction: "C" });
  assert.equal(runsForTodos([todo.id]).get(todo.id)!.filter((r) => r.ticket === "ABC-2").length, 2, "no run of its own for B and C");
  const p = getRun(waiting.id)!.prompt;
  assert.ok(p.includes("\nA") && p.includes("\nB") && p.includes("\nC"));
  assert.deepEqual(getTodo(todo.id)!.userNotes.filter((n) => n.run === waiting.id).map((n) => n.text), ["B", "C"]);
});
