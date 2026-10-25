import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * A payment todo ticked off pays its case: the amount booked on the case, the instalment due moved on to the next month (a one-off
 * paid: nothing due any more, the case done) — and the transfer, when it shows on the statement later, counted once.
 */
const day = (d: number) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
const plusMonth = (iso: string) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
};

async function world() {
  const { setInstalled } = await import("@/plugins/state");
  for (const p of ["people", "todos", "cases"]) setInstalled(p, true);
  const { addManualTodo, setTodoOps } = await import("@/lib/boards/store");
  const rate = addManualTodo({ ticket: "", text: "Rate 300 € (Az. DR II 1121/26) überweisen" });
  setTodoOps(rate.id, [{ type: "bank-transfer", name: "Sparkasse", iban: "DE02120300000000202051", bic: "", amount: "300.00", purpose: "DR II 1121/26" } as never], undefined, true);
  const rest = addManualTodo({ ticket: "", text: "Restforderung 11,52 € (Az. DR II 810/26) heute überweisen" });
  const { detectCases } = await import("@/plugins/cases/detect");
  detectCases();
  const { caseByKey, updateCase, getCase } = await import("@/plugins/cases/store");
  const { checked } = await import("@/plugins/cases/compile");
  const spk = caseByKey("DR II 1121/26")!;
  const swr = caseByKey("DR II 810/26")!;
  updateCase(spk.id, { compiled: checked({ title: "Sparkasse", open: 3618.13, installment: 300, next_due: day(-1), next_what: "Rate 300 €" }, spk.key, 1) });
  updateCase(swr.id, { compiled: checked({ title: "Rundfunkbeitrag", open: 11.52, next_due: day(-5), next_what: "Rest 11,52 €" }, swr.key, 1) });
  await import("@/plugins/cases/todo-paid"); // (its hook on todos done)
  return { rate, rest, spk, swr, getCase };
}

test("a payment todo ticked off: the case paid — the instalment's due on to next month, a rest paid closes it", async () => {
  const { rate, rest, spk, swr, getCase } = await world();
  const { setTodoStatus } = await import("@/lib/boards/store");
  const { paymentsOf } = await import("@/plugins/cases/bank");
  const due = getCase(spk.id)!.compiled!.nextDue!;
  setTodoStatus(rate.id, "done");
  assert.deepEqual(paymentsOf(spk.id).map((p) => [p.amount, p.date, p.txId]), [[300, day(0), `todo:${rate.id}`]]);
  assert.equal(getCase(spk.id)!.compiled!.nextDue, plusMonth(due), "the next instalment");
  assert.equal(getCase(spk.id)!.compiled!.done, false);
  setTodoStatus(rest.id, "done");
  assert.deepEqual(paymentsOf(swr.id).map((p) => p.amount), [11.52]);
  assert.equal(getCase(swr.id)!.compiled!.nextDue, null, "nothing due any more");
  assert.equal(getCase(swr.id)!.compiled!.done, true, "the rest paid: done");
  // Ticked once more (open again, done again): no second payment, the due date not moved twice.
  setTodoStatus(rate.id, "open");
  setTodoStatus(rate.id, "done");
  assert.equal(paymentsOf(spk.id).length, 1);
  assert.equal(getCase(spk.id)!.compiled!.nextDue, plusMonth(due));
});

test("a plan paid on a day of the month: the next instalment on that day of the next month", async () => {
  const { rate, spk, getCase } = await world();
  const { updateCase } = await import("@/plugins/cases/store");
  updateCase(spk.id, { compiled: { ...getCase(spk.id)!.compiled!, nextDue: "2027-01-23", installmentDay: 15, settled: undefined, at: "2027-01-20T00:00:00.000Z" } }); // (a summary of its own time: the other tests' payments are before it)
  const { payFromTodo } = await import("@/plugins/cases/todo-paid");
  payFromTodo(rate.id, "2027-01-23");
  assert.equal(getCase(spk.id)!.compiled!.nextDue, "2027-02-15", "the 15th, as the plan says — not the day it was late");
});

test("what is open after a payment, wherever it shows: the letter's amount less what was paid since", async () => {
  const { rate, spk, getCase } = await world();
  (await import("@/lib/boards/store")).setTodoStatus(rate.id, "done");
  const { openOf, caseStanding } = await import("@/plugins/cases/bank");
  const now = caseStanding(spk.id).open!;
  assert.ok(now < 3618.13, "paid on it");
  assert.equal(openOf(getCase(spk.id)!), now);
  const { CASES_WIDGETS } = await import("@/plugins/cases/widgets");
  const open = (await CASES_WIDGETS.find((x) => x.id === "cases.open")!.data({})) as { items: { meta?: string }[] };
  assert.ok(open.items.some((i) => i.meta === now.toLocaleString(undefined, { style: "currency", currency: "EUR" })), "the widget");
  const { caseRecords } = await import("@/plugins/cases/workspace-source");
  const recs = await caseRecords();
  assert.equal(recs.find((r) => r.ref === `case:${spk.id}`)!.typed!.find((x) => x.name === "Open")!.value, now, "the case's row");
});

test("the statement's booking settles the open todo: one payment, not the booking and the todo both (weeks after any other)", async () => {
  const { spk } = await world();
  const { paymentsOf, addBookings, matchPayments } = await import("@/plugins/cases/bank");
  const before = paymentsOf(spk.id).length;
  addBookings([{ date: day(15), amount: -300, currency: "EUR", text: "DR II 1121/26", counterparty: "Sparkasse", iban: "DE02120300000000202051", reference: "DR II 1121/26" }], "Giro");
  matchPayments();
  assert.equal(paymentsOf(spk.id).length, before + 1);
});

test("ticked off by hand, on the statement days later: the same payment — counted once", async () => {
  const { rate, spk } = await world();
  const { setTodoStatus } = await import("@/lib/boards/store");
  const { paymentsOf, addBookings, matchPayments } = await import("@/plugins/cases/bank");
  setTodoStatus(rate.id, "done");
  const after = paymentsOf(spk.id).length;
  addBookings([{ date: day(3), amount: -300, currency: "EUR", text: "DR II 1121/26 Rate", counterparty: "Sparkasse", iban: "DE02120300000000202051", reference: "DR II 1121/26 Rate" }], "Giro");
  matchPayments();
  assert.equal(paymentsOf(spk.id).length, after, "the booking is the payment there already");
});
