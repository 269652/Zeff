import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** A worker's "done" is a mark on the todo (highlighted, still open) - closing it is yours. */
test("a worker's completedTodos mark the todo, a click of yours closes it; Zeff's own runs still close", async () => {
  const { addFollowUp, getTodo, setTodoStatus } = await import("@/lib/boards/store");
  const { applyOutcome } = await import("@/lib/work/outcome");
  const { createRun, getRun } = await import("@/lib/work/store");

  const mk = (text: string) => addFollowUp({ ticket: "ABC-1", text, kind: "other", parentId: null as unknown as number, workRunId: null, source: "test" });
  const a = mk("Do the thing");
  const b = mk("Send the reply");
  const res = (id: number) => ({ outcome: "done" as const, summary: "Alles gemacht.\nZweite Zeile", entry: "Sache erledigt", completedTodos: [id], followUps: [] });
  const run = (todoId: number, provider: string) => getRun(createRun({ ticket: "ABC-1", todoId, mode: "code", provider, model: "sonnet", permissionMode: null, repo: null, prompt: "x" }).id)!;

  // A Claude worker reports it: open, marked, with who and why.
  const out = applyOutcome(run(a.id, "claude"), res(a.id));
  assert.deepEqual(out.marked, [a.id]);
  assert.deepEqual(out.closed, []);
  const t = getTodo(a.id)!;
  assert.equal(t.status, "open");
  assert.match(t.workerDone!.by, /^W-\d+ · sonnet$/);
  assert.equal(t.workerDone!.note, "Sache erledigt");

  // You close it: the mark is gone (and again if you reopen it).
  setTodoStatus(a.id, "done");
  assert.equal(getTodo(a.id)!.workerDone, null);
  setTodoStatus(a.id, "open");
  assert.equal(getTodo(a.id)!.workerDone, null);

  // Zeff's own run (your click on an operation): closes, as before.
  const own = applyOutcome(run(b.id, "zeff"), res(b.id));
  assert.deepEqual(own.closed, [b.id]);
  assert.equal(getTodo(b.id)!.status, "done");
});
