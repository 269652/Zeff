import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { setupTempData } from "./helpers";

// A session's ⋯ in the sidebar: archived (out of the list, back on asking) or deleted (its runs and
// logs gone, its todo kept) — and the sidebar lists only tickets with sessions.
setupTempData();

test("sessions archive, come back, and delete — not while they work", async () => {
  const { addSessionTodo, getTodo } = await import("@/lib/todos/store");
  const { createRun, getRun, updateRun } = await import("@/lib/work/store");
  const { logPath } = await import("@/lib/work/log");
  const { sessionTickets } = await import("@/lib/work/sessions");
  const { archivedSessions, deleteSession, setSessionArchived } = await import("@/lib/work/session-admin");
  const path = await import("node:path");

  const todo = addSessionTodo({ ticket: "ABC-1", text: "A session" });
  addSessionTodo({ ticket: "XYZ-2", text: "Only a todo, no session" });
  const run = createRun({ ticket: "ABC-1", todoId: todo.id, mode: "instruct", provider: "claude", model: null, permissionMode: null, repo: null, prompt: "go" });
  updateRun(run.id, { status: "done", startedAt: new Date().toISOString(), branch: "zeff/ABC-1-w1" });
  fs.mkdirSync(path.dirname(logPath(run.id)), { recursive: true });
  fs.writeFileSync(logPath(run.id), "{}\n");

  const listed = () => sessionTickets().flatMap((x) => x.sessions);
  assert.equal(listed().length, 1);
  assert.equal(listed()[0].branch, "zeff/ABC-1-w1");
  // (The page lists only tickets with sessions — XYZ-2 has a todo, no session.)
  assert.deepEqual(
    sessionTickets()
      .filter((x) => x.sessions.length > 0)
      .map((x) => x.ticket),
    ["ABC-1"],
  );

  setSessionArchived(todo.id, true);
  assert.equal(listed().length, 0, "archived: out of the list");
  assert.equal(sessionTickets({ archived: true }).flatMap((x) => x.sessions)[0]?.archived, true, "back on asking, marked");
  setSessionArchived(todo.id, false);
  assert.equal(listed().length, 1);

  updateRun(run.id, { status: "running" });
  assert.throws(() => deleteSession(todo.id), /working/);
  updateRun(run.id, { status: "done" });
  setSessionArchived(todo.id, true);
  assert.equal(deleteSession(todo.id), 1);
  assert.equal(getRun(run.id), undefined, "its runs gone");
  assert.equal(fs.existsSync(logPath(run.id)), false, "and their logs");
  assert.ok(getTodo(todo.id), "its todo stays");
  assert.equal(archivedSessions().has(todo.id), false);
});
