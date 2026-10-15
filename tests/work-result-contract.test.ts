import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** What a worker wrote once (PROJ-321): ops beside the report, "success" as the outcome. */
const WORKER_JSON = {
  outcome: "success",
  summary: "Ticket-Entwurf fertig.",
  entry: "PROJ-321: Ticket-Entwurf für Navigation-Story",
  completedTodos: [],
  followUps: [],
  mood: "good",
  ops: [
    { type: "jira-create", ticket: "PROJ-321", summary: "Navigation: Story", issueType: "Task", body: "Hintergrund …" },
    { type: "jira-assign", ticket: "PROJ-321", assignee: "rene" },
  ],
};

test("normalizeResult: nothing is dropped silently - what is changed or ignored is said", async () => {
  const { normalizeResult } = await import("@/lib/work/outcome");
  const res = normalizeResult(WORKER_JSON)!;
  assert.equal(res.outcome, "done");
  assert.equal(res.followUps.length, 1);
  assert.equal(res.followUps[0].ops!.length, 1);
  assert.equal((res.followUps[0].ops![0] as { assignee?: string }).assignee, "rene");
  const w = (res.warnings ?? []).join("\n");
  assert.match(w, /Unknown field.*mood/);
  assert.match(w, /success/);
  assert.match(w, /top level/);
  assert.match(w, /jira-assign/);
  // A clean result has no warnings.
  assert.equal(normalizeResult({ outcome: "done", summary: "x", entry: "y", completedTodos: [], followUps: [] })!.warnings, undefined);
});

test("applyOutcome: the top-level ops end up as a worker todo that carries the jira-create, and the todo says what was off", async () => {
  const { addFollowUp, getTodo, listTodos } = await import("@/lib/boards/store");
  const { applyOutcome, normalizeResult } = await import("@/lib/work/outcome");
  const { createRun, getRun } = await import("@/lib/work/store");
  const own = addFollowUp({ ticket: "PROJ-321", text: "Ticket-Entwurf", kind: "other", parentId: null as unknown as number, workRunId: null, source: "test" });
  const run = getRun(createRun({ ticket: "PROJ-321", todoId: own.id, mode: "code", provider: "claude", model: "sonnet", permissionMode: null, repo: null, prompt: "x" }).id)!;
  const out = applyOutcome(run, normalizeResult(WORKER_JSON)!);
  assert.equal(out.added.length, 1);
  const made = getTodo(out.added[0])!;
  assert.equal(made.byWorker, true);
  assert.deepEqual(made.ops.map((o) => o.type), ["jira-create"]);
  assert.ok(listTodos({ status: "open", byWorker: true }).some((t) => t.id === made.id));
  const notes = getTodo(own.id)!.userNotes.map((n) => n.text).join("\n");
  assert.match(notes, /Result format/);
});
