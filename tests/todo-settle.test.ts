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

test("a promise to pay that is due and has no todo gets one (once) — ticked off, the promise kept and the debt written down from it paid off", async () => {
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
  const debt = createDebt({ dir: "owe", title: "Mama", creditorId: mum, amount: 200, due: "2026-10-23", installment: null, fromClaim: claim.id });
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
  assert.equal(getPage(debt)!.props[DEBT.open] ?? 0, 0, "paid off");
  assert.equal(getPage(debt)!.props[DEBT.due] ?? null, null, "nothing due any more");
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

async function family(name: string) {
  const { setInstalled } = await import("@/plugins/state");
  for (const p of ["people", "todos", "cases", "finances", "workspace"]) setInstalled(p, true);
  const { createPerson } = await import("@/plugins/people/store");
  const person = createPerson({ name });
  const { ensureDebtsDatabase } = await import("@/plugins/finances/database");
  await ensureDebtsDatabase();
  for (const m of ["@/plugins/cases/server", "@/plugins/people/server", "@/plugins/finances/server"]) await import(m);
  return person;
}

test("a transfer on the statement with no todo for it (the fallback): the promise to whoever it paid kept, the debt from it down — once", async () => {
  const mum = await family("Johanna Testerin");
  const { addClaim, claimsOf } = await import("@/plugins/people/graph");
  addClaim({ personId: mum, kind: "commitment", text: "Ich habe Johanna zugesagt, ihr die 200€ zurückzuüberweisen.", sourceRef: `mail:wa:J|${Math.random()}`, direction: "mine", due: "2026-10-23", confidence: 0.9 });
  const claim = claimsOf(mum)[0];
  const { createDebt } = await import("@/plugins/finances/own");
  const debt = createDebt({ dir: "owe", title: "Mama", creditorId: mum, amount: 200, due: "2026-10-23", installment: null, fromClaim: claim.id });
  const { addBookings, matchPayments } = await import("@/plugins/cases/bank");
  addBookings([{ date: "2026-10-24", amount: -200, currency: "EUR", text: "Rückzahlung", counterparty: "Johanna Testerin", iban: "", reference: "Rückzahlung" }], "Giro");
  matchPayments();
  assert.ok(claimsOf(mum).find((c) => c.id === claim.id)!.doneAt, "the promise kept by the booking");
  const { getPage } = await import("@/plugins/workspace/store");
  const { DEBT } = await import("@/plugins/finances/fields");
  assert.equal(getPage(debt)!.props[DEBT.open] ?? 0, 0, "paid off");
  const { settledBy } = await import("@/lib/boards/todo-settle");
  assert.match(settledBy(`debt:${debt}`)[0].subject, /^tx:/, "settled by the booking");
  matchPayments();
  assert.equal(settledBy(`debt:${debt}`).length, 1, "read again: once");
});

test("a booking of a debt's instalment to its creditor (no promise, no todo): the debt down — not when a todo paid it in the days before", async () => {
  const elmar = await family("Elmar Testmann");
  const { createDebt } = await import("@/plugins/finances/own");
  const debt = createDebt({ dir: "owe", title: "Elmar", creditorId: elmar, amount: 1400, due: "2026-11-01", installment: 250 });
  const { addBookings, matchPayments } = await import("@/plugins/cases/bank");
  const { getPage } = await import("@/plugins/workspace/store");
  const { DEBT } = await import("@/plugins/finances/fields");
  addBookings([{ date: "2026-10-25", amount: -250, currency: "EUR", text: "Rate", counterparty: "Elmar Testmann", iban: "", reference: "Rate Oktober" }], "Giro");
  matchPayments();
  assert.equal(getPage(debt)!.props[DEBT.open], 1150);
  // Paid by hand, then the bank shows it two days later: the same payment.
  const { settleByHand } = await import("@/lib/boards/todo-settle");
  settleByHand(`debt:${debt}`, 250, "von Hand", "2026-11-01");
  assert.equal(getPage(debt)!.props[DEBT.open], 900);
  addBookings([{ date: "2026-11-03", amount: -250, currency: "EUR", text: "Rate", counterparty: "Elmar Testmann", iban: "", reference: "Rate November" }], "Giro");
  matchPayments();
  assert.equal(getPage(debt)!.props[DEBT.open], 900, "counted once");
});

test("what hangs together with a debt's row: the debt, what settled it — and what 'paid' pays by default; a todo's: what it settled", async () => {
  const { debt, todo } = await world();
  const { linksOf, refsOfRow } = await import("@/lib/boards/todo-settle");
  const { listTodos, setTodoStatus } = await import("@/lib/boards/store");
  assert.deepEqual(refsOfRow(debt), [`debt:${debt}`]);
  const before = linksOf({ refs: refsOfRow(debt) }, { openTodos: listTodos({ status: "open" }) });
  assert.equal(before.things[0].pay, 60, "no instalment: what is open");
  assert.ok(before.todos.some((x) => x.id === todo.id), "the open todo that would settle it");
  setTodoStatus(todo.id, "done");
  const after = linksOf({ refs: refsOfRow(debt) });
  assert.deepEqual(after.things[0].settledBy.map((s) => s.label), [`T-${todo.id}`]);
  assert.ok(linksOf({ todoId: todo.id }).things.some((x) => x.ref === `debt:${debt}`), "the todo's page: the debt it settled");
});

test("one due date: a todo hanging on a debt of yours takes its date — new ones too; changed on the todo, the debt follows", async () => {
  const elmar = await family("Elmar Fälligmann");
  const { createDebt } = await import("@/plugins/finances/own");
  const { addClaim, claimsOf } = await import("@/plugins/people/graph");
  const source = `mail:wa:E|${Math.random()}`;
  addClaim({ personId: elmar, kind: "commitment", text: "Ich habe Elmar zugesagt, ihm 250 € zu überweisen", sourceRef: source, direction: "mine", confidence: 0.9 });
  const claim = claimsOf(elmar)[0];
  // (The debt is the promise: written down from it, its 250 €.)
  const debt = createDebt({ dir: "owe", title: "Elmar", creditorId: elmar, amount: 250, due: "2026-11-01", installment: null, fromClaim: claim.id });
  const { addMailTodo, getTodo, setTodoDue } = await import("@/lib/boards/store");
  // A new todo from the message the promise was made in (the Mail-Durchsicht's): due when the debt's instalment is, at once.
  const todo = addMailTodo({ ticket: "", text: "Elmar 250 € überweisen", kind: "other", refs: [source], runId: null });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(getTodo(todo.id)!.due, "2026-11-01", "its due from the debt");
  // Moved on the todo by you: the debt's next due too.
  setTodoDue(todo.id, "2026-11-05");
  const { pushTodoDue } = await import("@/lib/boards/todo-settle");
  pushTodoDue(todo.id);
  const { getPage } = await import("@/plugins/workspace/store");
  const { DEBT } = await import("@/plugins/finances/fields");
  assert.equal(getPage(debt)!.props[DEBT.due], "2026-11-05");
});

test("a big debt that only names a small promise (written down from it, its figures yours since): the promise kept, the debt untouched", async () => {
  const mum = await family("Johanna Großschuld");
  const { addClaim, claimsOf } = await import("@/plugins/people/graph");
  const source = `mail:wa:JG|${Math.random()}`;
  addClaim({ personId: mum, kind: "commitment", text: "Ich habe Johanna zugesagt, ihr die erbetenen 200€ in 9 Tagen zurückzuüberweisen.", sourceRef: source, direction: "mine", due: "2026-10-23", confidence: 0.9 });
  const claim = claimsOf(mum)[0];
  const { createDebt } = await import("@/plugins/finances/own");
  const debt = createDebt({ dir: "owe", title: "Johanna", creditorId: mum, amount: 30000, due: "2031-03-01", installment: 400, fromClaim: claim.id });
  const { addMailTodo, setTodoStatus } = await import("@/lib/boards/store");
  const todo = addMailTodo({ ticket: "", text: "Johanna 200 € zurückzahlen", kind: "other", refs: [source], runId: null });
  setTodoStatus(todo.id, "done");
  assert.ok(claimsOf(mum).find((c) => c.id === claim.id)!.doneAt, "the promise kept");
  const { getPage } = await import("@/plugins/workspace/store");
  const { DEBT } = await import("@/plugins/finances/fields");
  assert.equal(getPage(debt)!.props[DEBT.open], 30000, "a debt of 30.000 € is not that promise of 200 €");
});

test("a debt's open is computed from the ledger: a figure you type in yourself is the new start — later payments count from it", async () => {
  const lea = await family("Lea Rechner");
  const { createDebt } = await import("@/plugins/finances/own");
  const debt = createDebt({ dir: "owe", title: "Lea", creditorId: lea, amount: 500, due: "2026-11-01", installment: 100 });
  const { settleByHand } = await import("@/lib/boards/todo-settle");
  const { getPage, setCell } = await import("@/plugins/workspace/store");
  const { DEBT } = await import("@/plugins/finances/fields");
  settleByHand(`debt:${debt}`, 100, "von Hand", "2026-10-30");
  assert.equal(getPage(debt)!.props[DEBT.open], 400);
  assert.equal(getPage(debt)!.props[DEBT.due], "2026-12-01", "the instalment due paid: the next one");
  setCell(debt, DEBT.open, 350); // (you, in the table: 50 € more paid in cash)
  settleByHand(`debt:${debt}`, 100, "von Hand", "2026-12-01");
  assert.equal(getPage(debt)!.props[DEBT.open], 250, "from your 350, not from the 400 computed before");
  const { allocationsOf } = await import("@/lib/money/ledger");
  assert.equal(allocationsOf(`debt:${debt}`).length, 2, "both payments in the ledger");
});

test("a thing's payments shown with it — one released (a wrong match): off the thing, its figures back, the proof no longer settles it", async () => {
  const kai = await family("Kai Zuordner");
  const { createDebt } = await import("@/plugins/finances/own");
  const debt = createDebt({ dir: "owe", title: "Kai", creditorId: kai, amount: 200, due: "2026-11-01", installment: null });
  const { settleByHand, linksOf, refsOfRow, releasePayment, settledBy } = await import("@/lib/boards/todo-settle");
  const { key } = settleByHand(`debt:${debt}`, 80, "von Hand", "2026-10-25");
  const { getPage } = await import("@/plugins/workspace/store");
  const { DEBT } = await import("@/plugins/finances/fields");
  assert.equal(getPage(debt)!.props[DEBT.open], 120);
  const thing = linksOf({ refs: refsOfRow(debt) }).things[0];
  assert.deepEqual(thing.payments.map((p) => [p.key, p.amount, p.source]), [[key, 80, "hand"]], "its payments, from the ledger");
  releasePayment(thing.payments[0].paymentId, `debt:${debt}`);
  assert.equal(getPage(debt)!.props[DEBT.open], 200, "as before it");
  assert.deepEqual(settledBy(`debt:${debt}`), [], "the proof no longer settles it");
});

test("paid by hand, taken back: the debt as it was", async () => {
  const karla = await family("Karla Testfrau");
  const { createDebt } = await import("@/plugins/finances/own");
  const debt = createDebt({ dir: "owe", title: "Karla", creditorId: karla, amount: 50, due: "2027-01-01", installment: null });
  const { settleByHand, unsettle } = await import("@/lib/boards/todo-settle");
  const { getPage } = await import("@/plugins/workspace/store");
  const { DEBT } = await import("@/plugins/finances/fields");
  const { key } = settleByHand(`debt:${debt}`, 50, "von Hand");
  assert.equal(getPage(debt)!.props[DEBT.open] ?? 0, 0, "paid off");
  unsettle(key);
  assert.equal(getPage(debt)!.props[DEBT.open], 50, "taken back");
});

test("the debts overview shows it: what is open after the todo", async () => {
  const { debt, todo } = await world();
  (await import("@/lib/boards/store")).setTodoStatus(todo.id, "done");
  const { debtPlans } = await import("@/plugins/finances/debts");
  assert.equal(debtPlans(undefined, "owe").debts.find((d) => d.id === debt)?.open ?? 0, 0, "paid off: nothing open");
});
