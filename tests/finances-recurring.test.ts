import assert from "node:assert/strict";
import test from "node:test";
import { detectRecurring, recipientKey, type Booking } from "@/plugins/finances/recurring";

const TODAY = "2026-10-22";
const monthly = (name: string, amount: number, day: number, months: number, endBack = 0): Booking[] =>
  Array.from({ length: months }, (_, i) => {
    const d = new Date(Date.UTC(2026, 9 - endBack - i, day));
    return { date: d.toISOString().slice(0, 10), amount: -amount, text: `To ${name} ${1000 + i}`, counterparty: "" };
  });

test("recurring payments: a subscription paid every month is one — its amount, a month, its rhythm, its next payment", () => {
  const r = detectRecurring([...monthly("Streamingdienst", 13.99, 5, 8), ...monthly("Handyvertrag", 15, 1, 5)], TODAY);
  assert.deepEqual(
    r.map((x) => [x.key, x.rhythm, x.amount, x.monthly, x.active]),
    [
      ["handyvertrag", "monthly", 15, 15, true],
      ["streamingdienst", "monthly", 13.99, 13.99, true],
    ],
  );
  assert.equal(r.find((x) => x.key === "streamingdienst")!.next, "2026-11-05", "the same day next month");
});

test("a yearly one costs a twelfth a month; shopping at the same place (amounts all over) and a stopped one are no contract — or an ended one", () => {
  const yearly: Booking[] = ["2024-03-10", "2025-03-11", "2026-03-10"].map((date) => ({ date, amount: -120, text: "", counterparty: "Haftpflicht AG" }));
  const shop: Booking[] = Array.from({ length: 8 }, (_, i) => ({ date: new Date(Date.UTC(2026, 2 + i, 3)).toISOString().slice(0, 10), amount: -(20 + i * 17), text: "Supermarkt", counterparty: "" }));
  const stopped = monthly("Fitnessstudio", 29, 15, 6, 6);
  const r = detectRecurring([...yearly, ...shop, ...stopped, { date: "2026-10-01", amount: 3552, text: "Gehalt", counterparty: "" }], TODAY);
  const hp = r.find((x) => x.key === "haftpflicht ag")!;
  assert.deepEqual([hp.rhythm, hp.monthly, hp.active], ["yearly", 10, true]);
  assert.ok(!r.some((x) => x.key === "supermarkt"), "amounts too far apart");
  assert.equal(r.find((x) => x.key === "fitnessstudio")!.active, false, "stopped half a year ago: ended");
  assert.ok(!r.some((x) => x.key === "gehalt"), "money coming in is none");
});

test("the recipient as compared: without numbers and the bank's words", () => {
  assert.equal(recipientKey({ text: "Zahlung an Stadtwerke 4711 Ref 2026-10", counterparty: "" }), "stadtwerke ref");
  assert.equal(recipientKey({ text: "x", counterparty: "To Max Muster" }), "max muster");
});
