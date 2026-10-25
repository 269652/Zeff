import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * The ledger (lib/money/ledger.ts): every payment once — a booking, a todo ticked off, "paid" by hand — and what it is for (its
 * allocations: a case, a debt). What is open is computed from it, never patched: the figure you set (or the letter's) less what was
 * allocated since. The same payment twice (a todo ticked off, then the bank's booking days later) is one payment.
 */

test("a payment allocated, the figure computed from it; the allocation released: as it was", async () => {
  const l = await import("@/lib/money/ledger");
  const p = l.recordPayment({ key: "todo:1", date: "2026-10-23", amount: 60, label: "T-1", source: "todo" });
  assert.equal(l.recordPayment({ key: "todo:1", date: "2026-10-23", amount: 60, label: "T-1", source: "todo" }).id, p.id, "once per key");
  l.allocate(p.id, "debt:9", 60);
  assert.equal(l.paidOn("debt:9"), 60);
  assert.deepEqual(l.allocationsOf("debt:9").map((a) => [a.key, a.amount, a.source]), [["todo:1", 60, "todo"]]);
  l.deallocate(p.id, "debt:9");
  assert.equal(l.paidOn("debt:9"), 0);
  assert.equal(l.paymentByKey("todo:1"), null, "a payment left for nothing goes");
});

test("the bank's booking of a payment ticked off days before is that payment — confirmed, not counted again", async () => {
  const l = await import("@/lib/money/ledger");
  const p = l.recordPayment({ key: "todo:2", date: "2026-10-23", amount: 300, label: "T-2", source: "todo" });
  l.allocate(p.id, "case:1", 300);
  const twin = l.twinOf({ amount: 300, date: "2026-10-26", refs: ["case:1"] });
  assert.equal(twin?.id, p.id, "the same amount for the same thing, three days later");
  l.confirmByBank(p.id, "tx-abc", "Buchung 26.10.");
  assert.equal(l.paidOn("case:1"), 300, "counted once");
  assert.equal(l.allocationsOf("case:1")[0].tx, "tx-abc", "confirmed by the booking");
  assert.equal(l.twinOf({ amount: 300, date: "2026-11-20", refs: ["case:1"] }), null, "weeks later: another payment");
  assert.equal(l.twinOf({ amount: 300, date: "2026-10-26", refs: ["case:1"] }), null, "confirmed already: no twin for a second booking");
});

test("what was paid since a day: only the allocations from then on count (a figure you set later starts afresh)", async () => {
  const l = await import("@/lib/money/ledger");
  const a = l.recordPayment({ key: "hand:a", date: "2026-09-01", amount: 100, label: "by hand", source: "hand" });
  l.allocate(a.id, "debt:7", 100);
  await new Promise((r) => setTimeout(r, 5));
  const since = new Date().toISOString();
  await new Promise((r) => setTimeout(r, 5));
  const b = l.recordPayment({ key: "hand:b", date: "2026-10-01", amount: 50, label: "by hand", source: "hand" });
  l.allocate(b.id, "debt:7", 50);
  assert.equal(l.paidOn("debt:7"), 150);
  assert.equal(l.paidOn("debt:7", { allocatedSince: since }), 50);
});
