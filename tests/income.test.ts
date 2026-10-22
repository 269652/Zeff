import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** "YYYY-MM" of the month `back` months before this one. */
const month = (back: number) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - back);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const fact = (back: number, amount: number) => ({ key: "net_income", period: month(back), amount, text: "Gehalt", pageId: `zeff:bank:revolut:${month(back)}`, pageTitle: `Kontoauszug ${month(back)}`, at: "2026-10-20T00:00:00Z" });

test("the monthly income is what the knowledge read off your statements: the average of the last three whole months it knows — the running month not counted; yours goes first", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("cases", true);
  setInstalled("finances", true);
  const { refreshIncome, monthlyIncome, setManualIncome } = await import("@/plugins/finances/income");
  assert.equal(monthlyIncome().source, "none", "nothing known yet");
  await refreshIncome({ read: async () => [fact(0, 9999), fact(1, 3552), fact(2, 3552), fact(3, 3200), fact(4, 1000)] });
  const i = monthlyIncome();
  assert.equal(i.amount, Math.round(((3552 * 2 + 3200) / 3) * 100) / 100);
  assert.equal(i.source, "knowledge");
  assert.deepEqual(i.months.map((m) => m.month), [month(3), month(2), month(1)]);
  // Two months only known: their average.
  await refreshIncome({ read: async () => [fact(1, 3000), fact(2, 3400)] });
  assert.equal(monthlyIncome().amount, 3200);
  // The knowledge not answering: what was read before stays.
  await refreshIncome({
    read: async () => {
      throw new Error("down");
    },
  });
  assert.equal(monthlyIncome().amount, 3200);
  setManualIncome(2800);
  assert.deepEqual([monthlyIncome().amount, monthlyIncome().source, monthlyIncome().derived], [2800, "manual", 3200]);
  setManualIncome(null);
  assert.equal(monthlyIncome().source, "knowledge");
});

test("the statements go to the knowledge as a page per account and month — what came in by sender, the largest payments out", async () => {
  const { addBookings } = await import("@/plugins/cases/bank");
  const { bankDocs } = await import("@/plugins/finances/knowledge-docs");
  const d = `${month(1)}-23`;
  addBookings([{ date: d, amount: 3552, currency: "EUR", text: "Zahlung von ACME GMBH", counterparty: "", iban: "", reference: "Gehalt" }, { date: d, amount: -900, currency: "EUR", text: "To Vermieter", counterparty: "Vermieter", iban: "", reference: "" }], "Revolut");
  const doc = bankDocs().find((x) => x.id === `zeff:bank:revolut:${month(1)}`)!;
  assert.equal(doc.space, "Zeff · Konto");
  assert.match(doc.body, /Eingänge \(nach Absender\)\n- Zahlung von ACME GMBH: 3\.552,00 €/);
  assert.match(doc.body, /Vermieter: 900,00 €/);
});
