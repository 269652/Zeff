import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** A session marks the other todos it takes on through Zeff's MCP (start_todo, as "W-n · Session"); they end with its run. */
test("side work of a session: shown while it goes, ended with its run", async () => {
  const { endSideWork, sideTodos, sideWorker } = await import("@/lib/work/actions");
  const { startAgentWork } = await import("@/lib/work/agent");
  const { addFollowUp, getTodo } = await import("@/lib/todos/store");
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
  const { addFollowUp } = await import("@/lib/todos/store");
  const todo = addFollowUp({ ticket: "ABC-5", text: "Session", kind: "other", parentId: null, workRunId: null, source: "test" });
  const text = taskFor("instruct", { todo, runId: 7, repo: null, cwd: "x", branch: null, base: null, isolation: "checkout" });
  assert.match(text, /start_todo/);
  assert.match(text, /W-7 · Session/);
});

test("the worker is told the todo's linked branch, or the naming convention when there is none", async () => {
  const { taskFor } = await import("@/lib/work/brief");
  const { addFollowUp } = await import("@/lib/todos/store");
  const todo = addFollowUp({ ticket: "ABC-6", text: "Fix it", kind: "fix", parentId: null, workRunId: null, source: "test" });
  const base = { todo, runId: 8, repo: "r", cwd: "x", branch: "zeff/ABC-6-w8", base: "main", isolation: "worktree" as const };
  const linked = taskFor("code", { ...base, linked: [{ branch: "feature/ABC-6-footer", label: "Merge Request !12", url: "https://x/mr/12" }], newBranch: "fix/ABC-6-<short-change>" });
  assert.match(linked, /feature\/ABC-6-footer/);
  assert.match(linked, /Merge Request !12/);
  assert.doesNotMatch(linked, /Namenskonvention/);
  const none = taskFor("code", { ...base, linked: [], newBranch: "fix/ABC-6-<short-change>" });
  assert.match(none, /Namenskonvention fix\/ABC-6-<short-change>/);
});

/** A session started without a ticket that takes a todo through start_todo moves under its ticket - no second session beside it. */
test("a session without a ticket moves under the todo it takes", async () => {
  const { startAgentWork } = await import("@/lib/work/agent");
  const { addFollowUp, addSessionTodo, getTodo } = await import("@/lib/todos/store");
  const { createRun, getRun, runsByStatus, updateRun } = await import("@/lib/work/store");
  const { withCallerRun } = await import("@/mcp/caller");

  const target = addFollowUp({ ticket: "ABC-171", text: "Das eigentliche Todo", kind: "other", parentId: null, workRunId: null, source: "test" });
  const placeholder = addSessionTodo({ ticket: "", text: "Mach T-171" });
  assert.ok("id" in placeholder);
  const run = createRun({ ticket: "", todoId: placeholder.id, mode: "instruct", provider: "claude", model: null, permissionMode: null, repo: null, prompt: "x" });
  updateRun(run.id, { status: "running" });

  // What the session's start_todo call does (its MCP config carries the run's id).
  const started = withCallerRun(String(run.id), () => startAgentWork({ todo: `T-${target.id}`, agent: "Claude Code" }));
  assert.equal(started.run.id, run.id, "the session itself is on the todo");
  assert.equal(getRun(run.id)!.todoId, target.id);
  assert.equal(getRun(run.id)!.ticket, "ABC-171");
  assert.equal(runsByStatus(["running"]).filter((r) => r.todoId === target.id).length, 1, "no second session");
  assert.equal(getTodo(placeholder.id)!.status, "dismissed");
  assert.equal(getTodo(placeholder.id)!.mergedInto, target.id);

  // Asked again it is still the same one.
  const again = withCallerRun(String(run.id), () => startAgentWork({ todo: `T-${target.id}` }));
  assert.equal(again.run.id, run.id);
  assert.ok(again.resumed);

  // Without the header (an agent outside Zeff) a run of its own is made, as before.
  const other = addFollowUp({ ticket: "ABC-172", text: "Anderes", kind: "other", parentId: null, workRunId: null, source: "test" });
  const outside = startAgentWork({ todo: `T-${other.id}`, agent: "Copilot" });
  assert.equal(outside.run.provider, "agent");
});
