import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** A Lage run taken back: the todos it made that you haven't touched go (dismissed, saying so); those you worked on stay. */
test("a run undone: its untouched open todos dismissed, one you wrote a note on and one you ticked off kept — and other runs' alone", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("todos", true);
  const s = await import("@/lib/boards/store");
  const run = s.startRun("test", null);
  const other = s.startRun("test", null);
  const a = s.addMailTodo({ ticket: "", text: "Formular ausfüllen", kind: "other", refs: [], runId: run });
  const b = s.addMailTodo({ ticket: "", text: "Rechnung prüfen", kind: "other", refs: [], runId: run });
  const c = s.addMailTodo({ ticket: "", text: "Termin bestätigen", kind: "other", refs: [], runId: run });
  const d = s.addMailTodo({ ticket: "", text: "Paket abholen", kind: "other", refs: [], runId: other });
  s.addTodoUserNote(b.id, "habe ich schon angefangen");
  s.setTodoStatus(c.id, "done");
  const { undoLageRun } = await import("@/lib/boards/run-undo");
  assert.deepEqual(undoLageRun(run), { dismissed: 1, kept: 2 });
  assert.equal(s.getTodo(a.id)!.status, "dismissed");
  assert.match(s.getTodo(a.id)!.note ?? "", new RegExp(`#${run}`));
  assert.equal(s.getTodo(b.id)!.status, "open", "your note on it: kept");
  assert.equal(s.getTodo(c.id)!.status, "done", "ticked off: kept");
  assert.equal(s.getTodo(d.id)!.status, "open", "another run's");
});
