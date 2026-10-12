import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

async function todo(ticket: string, text: string) {
  const { addFollowUp } = await import("@/lib/boards/store");
  return addFollowUp({ ticket, text, kind: "other", parentId: null as unknown as number, workRunId: null, source: "test" });
}

test("the AI only suggests a todo as done: it stays open, marked as a suggestion, until you confirm", async () => {
  const { suggestDone, getTodo, setTodoStatus } = await import("@/lib/boards/store");
  const t = await todo("SD-1", "Answer Lisa");
  suggestDone(t.id, "Mail-Durchsicht", "Lisa hat geantwortet");
  const s = getTodo(t.id)!;
  assert.equal(s.status, "open");
  assert.deepEqual({ by: s.workerDone?.by, note: s.workerDone?.note, suggested: s.workerDone?.suggested }, { by: "Mail-Durchsicht", note: "Lisa hat geantwortet", suggested: true });
  // Confirming (ticking it) closes it and clears the suggestion.
  setTodoStatus(t.id, "done");
  assert.equal(getTodo(t.id)!.status, "done");
  assert.equal(getTodo(t.id)!.workerDone, null);
});

test("the briefing run's 'resolved: done' is a suggestion; 'resolved: outdated' still drops the todo", async () => {
  const { reconcileTodos, getTodo } = await import("@/lib/boards/store");
  const a = await todo("SD-2", "Probably done");
  const b = await todo("SD-2", "Outdated");
  reconcileTodos({ tickets: [{ key: "SD-2", resolved: [{ id: a.id, done: true, why: "merged" }, { id: b.id, done: false, why: "obsolete" }], todos: [] }] } as never, 1);
  assert.equal(getTodo(a.id)!.status, "open");
  assert.equal(getTodo(a.id)!.workerDone?.suggested, true);
  assert.match(getTodo(a.id)!.workerDone?.note ?? "", /merged/);
  assert.equal(getTodo(b.id)!.status, "dismissed");
});
