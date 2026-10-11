import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** What became of each step's todos: done, dropped by you (against the step), taken back by the AI (not against it). */
test("each step's todos are counted by what became of them", async () => {
  const { attributed } = await import("@/lib/boards/activity");
  const { addMailTodo, addNoteTodo, setTodoStatus } = await import("@/lib/boards/store");
  const { aiQuality } = await import("@/lib/ai-quality");
  const mail = (text: string) => attributed("lage:1", () => addMailTodo({ ticket: "", text, kind: "other", refs: ["mail:a"], runId: 1 }));

  const a = mail("Formular für die Steuer ausfüllen");
  const b = mail("Newsletter abbestellen");
  const c = mail("Rechnung an Kunde schicken");
  const d = mail("Termin beim Zahnarzt bestätigen");
  mail("Paket bei der Post abholen");
  attributed("you", () => setTodoStatus(a.id, "done"));
  attributed("you", () => setTodoStatus(b.id, "dismissed"));
  attributed("you", () => setTodoStatus(c.id, "done"));
  // Taken back by the next run: not the step's fault.
  attributed("lage:2", () => setTodoStatus(d.id, "dismissed", "Laut Lauf überholt"));
  attributed("keep", () => addNoteTodo({ ticket: "", text: "Geschenk für Nadine kaufen", kind: "other", refs: ["keep:1"], runId: null }));

  const q = aiQuality(null);
  const m = q.rows.find((r) => r.origin === "mail")!;
  assert.equal(m.created, 5);
  assert.equal(m.done, 2);
  assert.equal(m.dismissedByYou, 1);
  assert.equal(m.withdrawn, 1);
  assert.equal(m.open, 1);
  assert.equal(Math.round(m.hitRate! * 100), 67, "done ÷ (done + dropped by you)");
  assert.equal(q.rows.find((r) => r.origin === "notes")?.created, 1);
  // Few judged: no rate yet.
  assert.equal(q.rows.find((r) => r.origin === "notes")?.hitRate, null);
});

/** A todo you dropped isn't one the reviews make again; one made anyway shows as proposed again. */
test("what you dropped counts as there for the reviews, and a repeat is shown", async () => {
  const { attributed } = await import("@/lib/boards/activity");
  const { addMailTodo, droppedByYou, setTodoStatus } = await import("@/lib/boards/store");
  const { duplicateTodo } = await import("@/lib/boards/similar");
  const { aiQuality } = await import("@/lib/ai-quality");
  const mail = (text: string) => attributed("lage:3", () => addMailTodo({ ticket: "", text, kind: "other", refs: ["mail:b"], runId: 3 }));

  const first = mail("Neue Crypto.com-Karte über die App beantragen, da die Prepaid-Karte ersetzt wird");
  attributed("you", () => setTodoStatus(first.id, "dismissed"));
  const again = { text: "Neue Crypto.com-Karte über die App beantragen, da die Prepaid-Karte nicht mehr weitergeführt wird", ops: [] };
  assert.ok(duplicateTodo(again, droppedByYou()), "the review sees it as there already");
  // Dropped by a run (overtaken): not yours — it may come again.
  const other = mail("Kündigung des Fitnessstudios abschicken");
  attributed("lage:4", () => setTodoStatus(other.id, "dismissed", "Laut Lauf überholt"));
  assert.ok(!droppedByYou().some((t) => t.id === other.id));

  // Made anyway (before the fix, say): listed as proposed again.
  const repeat = mail(again.text);
  const r = aiQuality(null).repeats.find((x) => x.id === repeat.id);
  assert.equal(r?.like.id, first.id);
});
