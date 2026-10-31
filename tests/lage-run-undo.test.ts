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
  const { undoLageRun } = await import("@/lib/runs/run-undo");
  assert.deepEqual(undoLageRun(run), { dismissed: 1, kept: 2, claims: 0 });
  assert.equal(s.getTodo(a.id)!.status, "dismissed");
  assert.match(s.getTodo(a.id)!.note ?? "", new RegExp(`#${run}`));
  assert.equal(s.getTodo(b.id)!.status, "open", "your note on it: kept");
  assert.equal(s.getTodo(c.id)!.status, "done", "ticked off: kept");
  assert.equal(s.getTodo(d.id)!.status, "open", "another run's");
});

test("a run undone: the promises and facts it read that you haven't looked at go too — one you confirmed stays", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const p of ["todos", "people"]) setInstalled(p, true);
  const s = await import("@/lib/runs/store");
  const { createPerson } = await import("@/plugins/people/store");
  const { addClaim, claimsOf, reviewClaim } = await import("@/plugins/people/graph");
  await import("@/plugins/people/server"); // (its part of a run taken back)
  const p = createPerson({ name: `Lauf Person ${Math.random()}` });
  addClaim({ personId: p, kind: "fact", text: "vor dem Lauf", confidence: 0.9 });
  const run = s.startRun("test", null);
  addClaim({ personId: p, kind: "commitment", text: "Ich rufe morgen an", direction: "mine", confidence: 0.9 });
  addClaim({ personId: p, kind: "fact", text: "wohnt in Freiburg", confidence: 0.9 });
  const confirmed = claimsOf(p).find((c) => c.text === "wohnt in Freiburg")!;
  reviewClaim(confirmed.id, "confirm");
  s.finishRun(run, { status: "ok", tickets: [], result: null } as never);
  const { undoLageRun } = await import("@/lib/runs/run-undo");
  const r = undoLageRun(run);
  assert.equal(r.claims, 1, "the run's unlooked-at promise");
  assert.deepEqual(claimsOf(p).map((c) => c.text).sort(), ["vor dem Lauf", "wohnt in Freiburg"], "the one before it and the one you confirmed stay");
});
