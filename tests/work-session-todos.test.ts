import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** The worker is told, with every message, which todo it is on - so it can tell a change of subject without being named one. */
test("an instruction run's brief lists the session's todos: its own, those it began, the ticket's other open ones", async () => {
  const { addSessionTodo, getTodo } = await import("@/lib/boards/store");
  const { createRun, updateRun } = await import("@/lib/work/store");
  const { taskFor } = await import("@/lib/work/brief");
  const own = addSessionTodo({ ticket: "ABC-5", text: "Fix the header" });
  const began = addSessionTodo({ ticket: "ABC-5", text: "Rewrite the footer" });
  const other = addSessionTodo({ ticket: "ABC-5", text: "Update the docs" });
  const run = createRun({ ticket: "ABC-5", todoId: own.id, mode: "instruct", provider: "claude", model: null, permissionMode: null, repo: null, prompt: "x" });
  const ctx = { todo: getTodo(own.id)!, runId: run.id, repo: null, cwd: "/tmp", branch: null, base: null, isolation: "worktree" as const };

  // Only its own: current is the session's todo; the others wait as open.
  let brief = taskFor("instruct", ctx);
  assert.match(brief, /## Todos dieser Session\nAktuell dran: T-\d+\./);
  assert.match(brief, new RegExp(`★ T-${own.id}: Fix the header`));
  assert.match(brief, new RegExp(`☐ T-${began.id}: Rewrite the footer`));
  assert.match(brief, new RegExp(`☐ T-${other.id}: Update the docs`));
  assert.match(brief, /Aktuell dran: T-\d+\./);
  assert.ok(brief.includes(`Aktuell dran: T-${own.id}.`));

  // The worker began another todo through start_todo (an agent run named after the session): that one is current now.
  const side = createRun({ ticket: "ABC-5", todoId: began.id, mode: "code", provider: "agent", model: `W-${run.id} · Session`, permissionMode: null, repo: null, prompt: "x" });
  updateRun(side.id, { status: "running" });
  brief = taskFor("instruct", ctx);
  assert.ok(brief.includes(`Aktuell dran: T-${began.id}.`));
  assert.match(brief, new RegExp(`▶ T-${began.id}: Rewrite the footer \\(von dir begonnen, läuft\\)`));
  assert.doesNotMatch(brief, new RegExp(`☐ T-${began.id}:`));
  assert.match(brief, new RegExp(`☐ T-${other.id}: Update the docs`));

  // The rule itself is in the brief.
  assert.match(brief, /Erkenne bei jeder Nachricht selbst/);
});
