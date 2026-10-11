import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** A session marks the other todos it takes on through Zeff's MCP (start_todo, as "W-n · Session"); they end with its run. */
test("side work of a session: shown while it goes, ended with its run", async () => {
  const { endSideWork, sideTodos, sideWorker } = await import("@/lib/work/actions");
  const { startAgentWork } = await import("@/lib/work/agent");
  const { addFollowUp, getTodo } = await import("@/lib/boards/store");
  const { createRun, getRun, runsByStatus, updateRun } = await import("@/lib/work/store");

  const own = addFollowUp({ ticket: "ABC-4", text: "Session", kind: "other", parentId: null, workRunId: null, source: "test" });
  const side = addFollowUp({ ticket: "ABC-4", text: "Nebenbei", kind: "other", parentId: null, workRunId: null, source: "test" });
  const run = createRun({ ticket: "ABC-4", todoId: own.id, mode: "instruct", provider: "claude", model: null, permissionMode: null, repo: null, prompt: "x" });
  updateRun(run.id, { status: "running" });

  // What the worker's start_todo call does.
  startAgentWork({ todo: `T-${side.id}`, agent: sideWorker(run.id), note: "Unteraufgaben" });
  const agent = runsByStatus(["running"]).find((r) => r.todoId === side.id);
  assert.ok(agent, "the named todo is being worked on");
  assert.equal(agent!.provider, "agent");
  assert.equal(getTodo(side.id)!.status, "open");
  assert.deepEqual(sideTodos([run.id]), [{ todoId: side.id, active: true }], "the session's header lists it");

  endSideWork(run.id, "Fertig.", "done");
  assert.equal(getRun(agent!.id)!.status, "done");
  assert.match(getRun(agent!.id)!.summary ?? "", /Teil von W-/);
  assert.deepEqual(sideTodos([run.id]), [{ todoId: side.id, active: false }]);
  assert.ok(!runsByStatus(["running"]).some((r) => r.todoId === side.id));
});

test("the session's instructions tell the worker to mark other todos itself", async () => {
  const { taskFor } = await import("@/lib/work/brief");
  const { addFollowUp } = await import("@/lib/boards/store");
  const todo = addFollowUp({ ticket: "ABC-5", text: "Session", kind: "other", parentId: null, workRunId: null, source: "test" });
  const text = taskFor("instruct", { todo, runId: 7, repo: null, cwd: "x", branch: null, base: null, isolation: "checkout" });
  assert.match(text, /start_todo/);
  assert.match(text, /W-7 · Session/);
});
