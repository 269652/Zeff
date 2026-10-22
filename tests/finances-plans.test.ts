import assert from "node:assert/strict";
import test from "node:test";
import { schedule, summarize } from "@/plugins/finances/plans";

const TODAY = "2026-10-22";

test("a plan's payments: the instalment each month from the next due day (on the plan's day of the month), the rest last — until nothing is open", () => {
  const s = schedule({ open: 3618.13, installment: 300, nextDue: "2026-10-20", day: 15 }, TODAY);
  assert.equal(s.kind, "plan");
  assert.equal(s.payments.length, 13, "12 × 300 and the rest");
  assert.deepEqual(s.payments.slice(0, 3).map((p) => p.date), ["2026-10-20", "2026-11-15", "2026-12-15"], "the first when it is due, then on the plan's day");
  assert.equal(s.payments.at(-1)!.amount, 18.13);
  assert.equal(s.end, "2027-10-15");
  assert.equal(s.payments.reduce((a, p) => a + p.amount, 0).toFixed(2), "3618.13");
});

test("a plan without a due day starts next month on the 1st (said so); a payment once is one payment on its day; nothing but an amount is no plan", () => {
  const p = schedule({ open: 4000, installment: 110, nextDue: null }, TODAY);
  assert.equal(p.kind, "plan");
  assert.equal(p.payments[0].date, "2026-11-01");
  assert.equal(p.estimatedStart, true);
  assert.equal(p.payments.length, 37);
  assert.equal(p.end, "2029-11-01");
  const once = schedule({ open: 11.52, installment: null, nextDue: "2026-10-15" }, TODAY);
  assert.deepEqual([once.kind, once.payments.length, once.end], ["once", 1, "2026-10-15"]);
  const none = schedule({ open: 5000, installment: null, nextDue: null }, TODAY);
  assert.deepEqual([none.kind, none.payments.length], ["none", 0]);
  const paid = schedule({ open: 0, installment: 100, nextDue: "2026-11-01" }, TODAY);
  assert.equal(paid.payments.length, 0, "nothing open: nothing to pay");
  // A plan of a later start (a pause): its first payment then.
  assert.equal(schedule({ open: 1300, installment: 100, nextDue: "2027-08-01" }, TODAY).end, "2028-08-01");
});

test("the plans together: the monthly fixed costs (the instalments running this month), when you are debt-free with the plans, what has no plan, the months ahead", () => {
  const plans = [
    { id: 1, ...schedule({ open: 3618.13, installment: 300, nextDue: "2026-10-20", day: 15 }, TODAY) },
    { id: 2, ...schedule({ open: 4000, installment: 110, nextDue: null }, TODAY) },
    { id: 3, ...schedule({ open: 11.52, installment: null, nextDue: "2026-10-15" }, TODAY) },
    { id: 4, ...schedule({ open: 5000, installment: null, nextDue: null }, TODAY) },
    { id: 5, ...schedule({ open: 1300, installment: 100, nextDue: "2027-08-01" }, TODAY) },
  ];
  const s = summarize(plans, TODAY);
  assert.equal(s.monthlyRates, 410, "the instalments running now (300 + 110) — the one starting later isn't yet");
  assert.equal(s.debtFree, "2029-11-01", "the last plan's last payment");
  assert.equal(s.unplanned, 5000);
  assert.equal(s.months[0].month, "2026-11");
  assert.equal(s.months[0].amount, 410);
  assert.equal(s.overdue, 11.52 + 300, "due before today, not paid");
  assert.equal(s.next?.id, 3, "the next payment: the earliest — an overdue one first (the SWR rest, 15.10.)");
});

test("the months ahead go until debt-free, however far — a plan starting in ten years is in them", () => {
  const plans = [{ id: 1, ...schedule({ open: 30000, installment: 250, nextDue: "2036-01-01" }, TODAY) }];
  const s = summarize(plans, TODAY);
  assert.equal(s.debtFree, "2045-12-01");
  assert.equal(s.months.at(-1)!.month, "2045-12", "the chart reaches the last payment");
  assert.equal(s.months.find((m) => m.month === "2036-01")!.amount, 250);
});
