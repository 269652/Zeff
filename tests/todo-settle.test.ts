import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * What hangs on a todo (lib/boards/todo-settle.ts): the things it comes from or settles — a case, a promise, a debt — found by the
 * plugins from the todo itself (its sources), and settled once when it is ticked off: wherever they show, they say so.
 */
async function world() {
  const { setInstalled } = await import("@/plugins/state");
  for (const p of ["people", "todos", "cases", "finances", "workspace"]) setInstalled(p, true);
  const { createPerson } = await import("@/plugins/people/store");
  const dad = createPerson({ name: `Papa ${Math.random()}` });
  const source = `mail:wa:Papa|${Math.random()}`;
  const { addClaim, claimsFrom } = await import("@/plugins/people/graph");
  addClaim({ personId: dad, kind: "commitment", text: "Ich habe Papa zugesagt, ihm die 40 € am Freitag zurückzugeben", evidence: "Kann's dir Freitag zurück geben", sourceRef: source, direction: "mine", due: "2026-10-23", confidence: 0.9 });
  addClaim({ personId: dad, kind: "commitment", text: "Ich habe Papa zugesagt, die zusätzlichen 20 € zurückzuschicken", sourceRef: source, direction: "mine", confidence: 0.9 });
  // In the same message, not what the todo pays: a plan of instalments, and one without money.
  addClaim({ personId: dad, kind: "commitment", text: "Ratenplan mit Papa: 10 Raten à 40 €", sourceRef: source, direction: "mine", confidence: 0.9 });
  addClaim({ personId: dad, kind: "commitment", text: "Ich rufe Papa am Sonntag an", sourceRef: source, direction: "mine", confidence: 0.9 });
  const [claim, extra, plan, call] = claimsFrom(source).sort((a, b) => a.id - b.id);
  const { ensureDebtsDatabase } = await import("@/plugins/finances/database");
  await ensureDebtsDatabase();
  const { createDebt } = await import("@/plugins/finances/own");
  const debt = createDebt({ dir: "owe", title: "Papa", creditorId: dad, amount: 60, due: "2026-10-23", installment: null, fromClaim: claim.id });
  const { addManualTodo, setTodoOps } = await import("@/lib/boards/store");
  const todo = addManualTodo({ ticket: "", text: "Papa die geliehenen 40 € und 20 € am Freitag zurückgeben" });
  setTodoOps(todo.id, [{ type: "bank-transfer", name: "Papa", iban: "DE02120300000000202051", bic: "", amount: "40.00", purpose: "Zurück" } as never], undefined, true);
  const { getDb, schema } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  getDb().update(schema.todos).set({ refs: JSON.stringify([source]) }).where(eq(schema.todos.id, todo.id)).run();
  for (const m of ["@/plugins/cases/server", "@/plugins/people/server", "@/plugins/finances/server"]) await import(m); // (their links to todos)
  return { dad, claim, extra, plan, call, debt, todo };
}

test("a todo ticked off settles what hangs on it: the promises it pays kept, the debt down by them — and says by which todo", async () => {
  const { claim, extra, plan, call, debt, todo } = await world();
  const { linkedRefs, settledBy } = await import("@/lib/boards/todo-settle");
  const { getTodo, setTodoStatus } = await import("@/lib/boards/store");
  assert.deepEqual(linkedRefs(getTodo(todo.id)!).sort(), [`claim:${claim.id}`, `claim:${extra.id}`, `debt:${debt}`].sort(), "the promises of the amounts it pays — not a plan of instalments, not one without money");
  void plan;
  void call;
  setTodoStatus(todo.id, "done");
  const { claimsOf } = await import("@/plugins/people/graph");
  assert.ok(claimsOf(claim.personId).find((c) => c.id === claim.id)!.doneAt, "the promise kept");
  const { getPage } = await import("@/plugins/workspace/store");
  const { DEBT } = await import("@/plugins/finances/fields");
  assert.equal(getPage(debt)!.props[DEBT.open] ?? 0, 0, "60 less the 40 and the 20 of the promises kept");
  assert.deepEqual(settledBy(`debt:${debt}`).map((s) => s.todoId), [todo.id]);
  // Ticked again: nothing twice.
  setTodoStatus(todo.id, "open");
  setTodoStatus(todo.id, "done");
  assert.equal(getPage(debt)!.props[DEBT.open] ?? 0, 0);
});

test("a promise to pay that is due and has no todo gets one (once) — ticked off, the promise kept and the debt down; a plan years off stays as it is", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const p of ["people", "todos", "finances", "workspace"]) setInstalled(p, true);
  const { createPerson } = await import("@/plugins/people/store");
  const mum = createPerson({ name: `Mama ${Math.random()}` });
  const source = `mail:wa:Mama|${Math.random()}`;
  const { addClaim, claimsFrom, claimsOf } = await import("@/plugins/people/graph");
  addClaim({ personId: mum, kind: "commitment", text: "Ich habe Mama zugesagt, ihr die erbetenen 200€ in 9 Tagen zurückzuüberweisen.", sourceRef: source, direction: "mine", due: "2026-10-23", confidence: 0.9 });
  const claim = claimsFrom(source)[0];
  const { ensureDebtsDatabase } = await import("@/plugins/finances/database");
  await ensureDebtsDatabase();
  const { createDebt } = await import("@/plugins/finances/own");
  const debt = createDebt({ dir: "owe", title: "Mama", creditorId: mum, amount: 30000, due: "2031-03-01", installment: 400, fromClaim: claim.id });
  for (const m of ["@/plugins/people/server", "@/plugins/finances/server"]) await import(m);
  const { promiseTodos } = await import("@/plugins/people/promise-todos");
  const made = promiseTodos("2026-10-25");
  assert.equal(made.length, 1, "one todo for the promise");
  assert.equal(promiseTodos("2026-10-25").length, 0, "once");
  const { getTodo, setTodoStatus } = await import("@/lib/boards/store");
  const todo = getTodo(made[0])!;
  assert.ok(todo.refs.includes(source), "it comes from where the promise was made");
  assert.equal(todo.due, "2026-10-23");
  setTodoStatus(todo.id, "done");
  assert.ok(claimsOf(mum).find((c) => c.id === claim.id)!.doneAt, "the promise kept");
  const { getPage } = await import("@/plugins/workspace/store");
  const { DEBT } = await import("@/plugins/finances/fields");
  assert.equal(getPage(debt)!.props[DEBT.open], 29800);
  assert.equal(getPage(debt)!.props[DEBT.due], "2031-03-01", "paid ahead: the plan starts when it starts");
});

test("a todo opened again takes back what it settled: the promises open, the debt as it was — and says why in the row's history", async () => {
  const { claim, extra, debt, todo } = await world();
  const { setTodoStatus } = await import("@/lib/boards/store");
  const { settledBy } = await import("@/lib/boards/todo-settle");
  const { claimsOf } = await import("@/plugins/people/graph");
  const { getPage } = await import("@/plugins/workspace/store");
  const { DEBT } = await import("@/plugins/finances/fields");
  setTodoStatus(todo.id, "done");
  const { activityOf } = await import("@/plugins/workspace/activity");
  assert.match(activityOf(debt).find((l) => l.field !== "created")?.cause ?? "", new RegExp(`T-${todo.id}`), "the debt's history names the todo");
  setTodoStatus(todo.id, "open");
  assert.equal(getPage(debt)!.props[DEBT.open], 60, "the debt as it was");
  for (const c of [claim, extra]) assert.equal(claimsOf(c.personId).find((x) => x.id === c.id)!.doneAt, null, "the promise open again");
  assert.deepEqual(settledBy(`debt:${debt}`), []);
  setTodoStatus(todo.id, "done");
  assert.equal(getPage(debt)!.props[DEBT.open] ?? 0, 0, "done again: settled again");
});

test("the debts overview shows it: what is open after the todo", async () => {
  const { debt, todo } = await world();
  (await import("@/lib/boards/store")).setTodoStatus(todo.id, "done");
  const { debtPlans } = await import("@/plugins/finances/debts");
  assert.equal(debtPlans(undefined, "owe").debts.find((d) => d.id === debt)?.open ?? 0, 0, "paid off: nothing open");
});
