import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

type Plan = { path: string | null; steps: { text: string; kind: string; owner: string; ops: unknown[] }[] }[];
const step = (text: string, kind = "other") => ({ text, kind, owner: "me", ops: [] });

async function mk(ticket: string, text: string, extra: { planned?: Plan; byWorker?: boolean; source?: string; parentId?: number | null } = {}) {
  const { addFollowUp } = await import("@/lib/boards/store");
  return addFollowUp({ ticket, text, kind: "other", parentId: (extra.parentId ?? null) as number, workRunId: null, source: extra.source ?? "test", planned: extra.planned as never, byWorker: extra.byWorker });
}
const openOn = async (ticket: string) => (await import("@/lib/boards/store")).listTodos({ ticket, status: "open" });

test("whatever makes a todo, one that only repeats an open todo on the ticket isn't made again — also when it is a part of it", async () => {
  const a = await mk("DD-1", "Nach dem Live-Deployment am 13.10. Darstellung auf Live prüfen und Jens im Ticket Bescheid geben.");
  const b = await mk("DD-1", "Nach dem Live-Deployment am 13.10. die Darstellung auf Live prüfen.", { source: "Planned after T-1" });
  assert.equal(b.id, a.id, "the open one is the answer");
  assert.equal((await openOn("DD-1")).length, 1);
  // Another ticket may have its own.
  const other = await mk("DD-2", "Nach dem Live-Deployment am 13.10. die Darstellung auf Live prüfen.");
  assert.notEqual(other.id, a.id);
  // Something else on the same ticket is made.
  const c = await mk("DD-1", "Christopher fragen, wann er den Report mit mir prüfen kann.");
  assert.notEqual(c.id, a.id);
});

test("a todo equal to a step another todo has planned isn't made — that step becomes it anyway", async () => {
  await mk("DD-3", "Implementieren", { planned: [{ path: null, steps: [step("Nach dem Deployment die Darstellung auf Live prüfen und Bescheid geben")] }] });
  const again = await mk("DD-3", "Nach dem Deployment die Darstellung auf Live prüfen.");
  assert.match(again.text, /^Implementieren/, "answered with the todo that has it planned");
  assert.equal((await openOn("DD-3")).length, 1);
});

test("a planned step that an open todo already is isn't made when its todo is ticked off — the rest of the plan goes on that todo", async () => {
  const { setTodoStatus, getTodo } = await import("@/lib/boards/store");
  const exists = await mk("DD-4", "Nach dem Live-Deployment die Darstellung auf Live prüfen und Jens Bescheid geben.", { planned: [{ path: null, steps: [step("Jens im Ticket Bescheid geben, dass der Titel live ist")] }] });
  const first = await mk("DD-4", "Pipeline von main prüfen", { planned: [{ path: null, steps: [step("Nach dem Live-Deployment die Darstellung auf Live prüfen.", "test"), step("Ticket auf Done setzen")] }] });
  setTodoStatus(first.id, "done");
  const open = await openOn("DD-4");
  assert.deepEqual(open.map((t) => t.id), [exists.id], "no second todo for the same step");
  const plan = getTodo(exists.id)!.planned[0].steps.map((s) => s.text);
  assert.ok(plan.includes("Ticket auf Done setzen"), "what came after it is planned now behind the todo that has it");
  assert.equal(plan.filter((t) => /Jens im Ticket Bescheid/.test(t)).length, 1, "and what was planned already isn't there twice");
});

test("what an AI or a worker would make again — a todo done or dismissed in the last days — isn't made; what you add yourself is", async () => {
  const { setTodoStatus, addManualTodo } = await import("@/lib/boards/store");
  const done = await mk("DD-5", "Mit Rico klären, ob der Bestell-Link ein Deployment braucht");
  setTodoStatus(done.id, "done");
  const dropped = await mk("DD-5", "Storybook Stories für die Navigation nachziehen");
  setTodoStatus(dropped.id, "dismissed");
  const again = await mk("DD-5", "Mit Rico klären, ob der Bestell-Link ein Deployment braucht.", { byWorker: true, source: "Follow-up from W-9" });
  assert.equal(again.id, done.id);
  const again2 = await mk("DD-5", "Storybook Stories für die Navigation nachziehen", { source: "Follow-up from W-10" });
  assert.equal(again2.id, dropped.id);
  assert.equal((await openOn("DD-5")).length, 0, "nothing new is open");
  // By hand is a decision: it's made.
  const mine = addManualTodo({ ticket: "DD-5", text: "Mit Rico klären, ob der Bestell-Link ein Deployment braucht" });
  assert.equal(mine.status, "open");
  assert.notEqual(mine.id, done.id);
});

test("the todos the mail, note and document reviews find aren't made twice either", async () => {
  const { addMailTodo, addNoteTodo, addDocTodo } = await import("@/lib/boards/store");
  const first = addMailTodo({ ticket: "DD-6", text: "Die Pflichtschulung Datenschutz bis Freitag absolvieren", kind: "other", refs: ["mail:a"], runId: null });
  const second = addMailTodo({ ticket: "DD-6", text: "Pflichtschulung Datenschutz absolvieren bis Freitag", kind: "other", refs: ["mail:b"], runId: null });
  assert.equal(second.id, first.id);
  assert.equal(addNoteTodo({ ticket: "DD-6", text: "Die Pflichtschulung Datenschutz bis Freitag absolvieren", kind: "other", refs: ["keep:x"], runId: null }).id, first.id);
  assert.equal(addDocTodo({ ticket: "DD-6", text: "Die Pflichtschulung Datenschutz bis Freitag absolvieren", kind: "other", refs: ["doc:1"], runId: null }).id, first.id);
  // Where it comes from is kept: the second mail is a source of the todo too.
  const { getTodo } = await import("@/lib/boards/store");
  assert.ok(getTodo(first.id)!.refs.includes("mail:b"));
});
