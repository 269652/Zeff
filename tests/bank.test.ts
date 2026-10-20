import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const IBAN = "DE22 6609 0800 0007 7773 02";
const day = (d: number) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);

/** Revolut's statement export (Excel/CSV): Type, Product, Started Date, Completed Date, Description, Amount, Fee, Currency, State, Balance. */
const REVOLUT = `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
TRANSFER,Current,${day(-3)} 09:12:01,${day(-3)} 09:12:05,To Nathanael Dienstkonto,-11.52,0.00,EUR,COMPLETED,120.40
CARD_PAYMENT,Current,${day(-2)} 18:00:00,${day(-2)} 18:00:01,Rewe,-23.10,0.00,EUR,COMPLETED,97.30
TOPUP,Current,${day(-1)} 08:00:00,${day(-1)} 08:00:01,Gehalt Acme,2100.00,0.00,EUR,COMPLETED,2197.30
TRANSFER,Current,${day(0)} 10:00:00,,To Nathanael Dienstkonto,-300.00,0.00,EUR,PENDING,1897.30
`;

async function seed() {
  const { setInstalled } = await import("@/plugins/state");
  for (const p of ["people", "todos", "cases"]) setInstalled(p, true);
  const { createPerson, listPeople } = await import("@/plugins/people/store");
  const had = listPeople().find((p) => p.name === "Ulla Nathanael");
  if (had) return;
  const { addClaim } = await import("@/plugins/people/graph");
  const ogv = createPerson({ name: "Ulla Nathanael", emails: ["ogv.nathanael@gvjustiz.de"] });
  addClaim({ personId: ogv, kind: "fact", text: `Dienstkonto: Empfänger Nathanael Dienstkonto, IBAN ${IBAN}, BIC GENODE61BBB.`, evidence: "IBAN", sourceRef: "doc:1", confidence: 0.9 });
  (await import("@/plugins/people/details")).syncDetails(ogv);
  const { ensureCase, updateCase } = await import("@/plugins/cases/store");
  const { checked } = await import("@/plugins/cases/compile");
  const swr = ensureCase("DR II 810/26", "DR II 810/26", new Date().toISOString());
  updateCase(swr.id, { personId: ogv, compiled: { ...checked({ title: "Rundfunkbeitrag SWR", open: 11.52, next_due: day(-5), next_what: "Rest 11,52 €", iban: IBAN, payee: "Nathanael Dienstkonto" }, "DR II 810/26", 3), at: new Date(Date.now() - 10 * 864e5).toISOString() } });
  const spk = ensureCase("DR II 1121/26", "DR II 1121/26", new Date().toISOString());
  updateCase(spk.id, { personId: ogv, compiled: { ...checked({ title: "Sparkasse", total: 3618.13, open: 3618.13, installment: 300, next_due: day(-12), next_what: "Rate 300 €", iban: IBAN, payee: "Nathanael Dienstkonto" }, "DR II 1121/26", 3), at: new Date(Date.now() - 20 * 864e5).toISOString() } });
  const { getDb, schema } = await import("@/db");
  const now = new Date().toISOString();
  const op = (amount: string, purpose: string) => [{ type: "bank-transfer", name: "Nathanael Dienstkonto", iban: IBAN, bic: "GENODE61BBB", amount, purpose }];
  getDb().insert(schema.todos).values({ ticket: "", text: "Restforderung 11,52 € (Az. DR II 810/26) überweisen", kind: "other", owner: "me", status: "open", source: "Mail", refs: "[]", ops: JSON.stringify(op("11.52", "DR II 810/26")), createdAt: now, updatedAt: now } as never).run();
}

test("bank: a statement read — Revolut's export or any CSV with a date, an amount and a text; the same booking never twice; pending ones not yet", async () => {
  const { parseStatement } = await import("@/plugins/cases/bank");
  const rows = parseStatement(REVOLUT);
  assert.equal(rows.length, 3, "the pending transfer waits until it is completed");
  assert.deepEqual(rows.map((r) => [r.date, r.amount, r.text]), [
    [day(-3), -11.52, "To Nathanael Dienstkonto"],
    [day(-2), -23.1, "Rewe"],
    [day(-1), 2100, "Gehalt Acme"],
  ]);
  assert.equal(rows[0].counterparty, "Nathanael Dienstkonto");
  // A German export: semicolons, decimal commas, dd.mm.yyyy, Empfänger and Verwendungszweck columns.
  const de = parseStatement(`Buchungstag;Empfänger;Verwendungszweck;IBAN;Betrag\n15.10.2026;Nathanael Dienstkonto;DR II 1121/26;${IBAN};-300,00\n`);
  assert.deepEqual([de[0].date, de[0].amount, de[0].counterparty, de[0].reference, de[0].iban], ["2026-10-15", -300, "Nathanael Dienstkonto", "DR II 1121/26", IBAN.replace(/\s/g, "")]);
  assert.throws(() => parseStatement("foo,bar\n1,2\n"), /date|amount/i);
  // Revolut's German export: its own column names, ABGESCHLOSSEN, the completion date; a pending one waits.
  const revDe = parseStatement(
    "Art,Produkt,Datum des Beginns,Datum des Abschlusses,Beschreibung,Betrag,Gebühr,Währung,Status,Kontostand\n" +
      "Transfer,Giro,2026-03-24 12:21:49,2026-03-24 12:21:50,To Ulrike Nathanael,-64.06,0.00,EUR,ABGESCHLOSSEN,2654.40\n" +
      "Transfer,Giro,2026-10-20 10:00:00,,To Ulrike Nathanael,-300.00,0.00,EUR,AUSSTEHEND,2354.40\n",
  );
  assert.deepEqual(revDe.map((r) => [r.date, r.amount, r.counterparty]), [["2026-03-24", -64.06, "Ulrike Nathanael"]]);

  await seed();
  const { importStatement, listTransactions } = await import("@/plugins/cases/bank");
  const r = importStatement(REVOLUT, "Revolut");
  assert.equal(r.added, 3);
  assert.equal(importStatement(REVOLUT, "Revolut").added, 0, "not twice");
  assert.equal(listTransactions().length, 3);
});

test("bank: a payment out matched to its transfer and its case — the todo done with a note, the case's paid and open follow; the rest unmatched", async () => {
  await seed();
  const { matchPayments, paymentsOf } = await import("@/plugins/cases/bank");
  const r = matchPayments();
  assert.equal(r.matched, 1, "the 11,52 € — the 23,10 € at Rewe and the salary are no case's");
  const { listTodos } = await import("@/lib/boards/store");
  const todo = listTodos({ status: "all" }).find((x) => /Restforderung 11,52/.test(x.text))!;
  assert.equal(todo.status, "done");
  assert.match(todo.userNotes.at(-1)!.text, /11,52 €.*Revolut|Kontoauszug/);
  const { caseByKey } = await import("@/plugins/cases/store");
  const swr = caseByKey("DR II 810/26")!;
  assert.deepEqual(paymentsOf(swr.id).map((p) => p.amount), [11.52]);
  const { caseStanding } = await import("@/plugins/cases/bank");
  assert.equal(caseStanding(swr.id).open, 0, "paid since it was summed up");
  assert.equal(matchPayments().matched, 0, "once");
});

test("bank: an instalment overdue for ten days warns — a todo, once — before the plan lapses", async () => {
  await seed();
  const { overdueWarnings } = await import("@/plugins/cases/bank");
  const made = overdueWarnings(day(0));
  assert.equal(made, 1, "the Sparkasse's rate, 12 days late, nothing paid since");
  const { listTodos } = await import("@/lib/boards/store");
  const w = listTodos({ status: "open" }).find((x) => /DR II 1121\/26/.test(x.text) && /überfällig/i.test(x.text));
  assert.ok(w);
  assert.equal(w!.ops.some((o) => o.type === "bank-transfer"), true, "with its transfer");
  assert.equal(overdueWarnings(day(0)), 0, "once");
});

test("debts: one overview of every creditor — case number, who for, total, open, instalment, next due, last payment, contact — and the months ahead against your income", async () => {
  await seed();
  const { debtOverview } = await import("@/plugins/cases/bank");
  const o = debtOverview({ income: 2100, today: day(0) });
  assert.deepEqual(o.rows.map((r) => r.caseNumber).sort(), ["DR II 1121/26", "DR II 810/26"]);
  const spk = o.rows.find((r) => r.caseNumber === "DR II 1121/26")!;
  assert.equal(spk.installment, 300);
  assert.match(spk.contact, /ogv\.nathanael@gvjustiz\.de/);
  assert.equal(o.totals.installments, 300);
  assert.equal(o.months[0].left, 1800, "income less the instalments that month");
});

test("bank: the same payment read again from another source (the bank connection) counts once", async () => {
  await seed();
  const { addBookings, matchPayments, paymentsOf } = await import("@/plugins/cases/bank");
  addBookings([{ date: day(-2), amount: -11.52, currency: "EUR", text: "Nathanael Dienstkonto", counterparty: "Nathanael Dienstkonto", iban: IBAN.replace(/\s/g, ""), reference: "DR II 810/26" }], "Revolut API");
  matchPayments();
  const { caseByKey } = await import("@/plugins/cases/store");
  assert.equal(paymentsOf(caseByKey("DR II 810/26")!.id).length, 1);
});

test("bank: a PDF statement by its words' places (Revolut) — a dated line opens a booking, the lines under it (An:, Referenz:) belong to it; out or in by the column", async () => {
  const { bookingsFromWords } = await import("@/plugins/cases/bank");
  const w = (x: number, y: number, text: string) => ({ x, y, text });
  const page = [
    w(42, 142, "Datum"), w(124, 142, "Beschreibung"), w(335, 142, "Geldausgang"), w(417, 142, "Geldeingang"), w(513, 142, "Kontostand"),
    w(42, 162, "23.02.2026"), w(124, 162, "To"), w(137, 162, "Ulrike"), w(165, 162, "Nathanael"), w(335, 162, "76,50€"), w(526, 162, "391,45€"),
    w(124, 172, "Referenz:"), w(160, 172, "11"), w(170, 172, "DR"), w(182, 172, "II"), w(190, 172, "1168/25"),
    w(124, 180, "An:"), w(140, 180, "Ulrike"), w(170, 180, "Nathanael,"), w(210, 180, "DE22660908000007777302"),
    w(42, 196, "24.02.2026"), w(124, 196, "Zahlung"), w(160, 196, "von"), w(180, 196, "MORITZ"), w(220, 196, "ROESSLER"), w(417, 196, "2.100,00€"), w(526, 196, "2.491,45€"),
    w(124, 206, "Referenz:"), w(160, 206, "Gehalt"),
    w(85, 722, "Verlorene"), w(122, 722, "oder"), w(141, 722, "gestohlene"),
  ];
  assert.deepEqual(bookingsFromWords([page]).map((b) => [b.date, b.amount, b.counterparty, b.iban, b.reference]), [
    ["2026-02-23", -76.5, "Ulrike Nathanael", "DE22660908000007777302", "11 DR II 1168/25"],
    ["2026-02-24", 2100, "MORITZ ROESSLER", "", "Gehalt"],
  ]);
  // English statements: Money out / Money in / Balance, dates as "Oct 17, 2026".
  const en = [
    w(42, 100, "Date"), w(124, 100, "Description"), w(335, 100, "Money"), w(362, 100, "out"), w(417, 100, "Money"), w(444, 100, "in"), w(513, 100, "Balance"),
    w(42, 120, "Oct"), w(58, 120, "17,"), w(72, 120, "2026"), w(124, 120, "To"), w(137, 120, "Nathanael"), w(180, 120, "Dienstkonto"), w(335, 120, "€11.52"), w(526, 120, "€120.40"),
  ];
  assert.deepEqual(bookingsFromWords([en]).map((b) => [b.date, b.amount, b.counterparty]), [["2026-10-17", -11.52, "Nathanael Dienstkonto"]]);
});

test("bank: a statement that comes in as a document (a CSV from your Drive folder) is read by itself — once", async () => {
  await seed();
  const { addDocument } = await import("@/plugins/documents/store");
  const csv = "Art,Produkt,Datum des Beginns,Datum des Abschlusses,Beschreibung,Betrag,Gebühr,Währung,Status,Kontostand\nTransfer,Giro,2026-10-21 09:00:00,2026-10-21 09:00:01,To Nathanael Dienstkonto,-300.00,0.00,EUR,ABGESCHLOSSEN,100.00\n";
  addDocument("account-statement_2026-10_de-de.csv", Buffer.from(csv), "text/csv");
  addDocument("Einkaufsliste.csv", Buffer.from("Ding,Menge\nMilch,1\n"), "text/csv");
  const { importStatementDocuments, listTransactions } = await import("@/plugins/cases/bank");
  const before = listTransactions().length;
  const r = importStatementDocuments();
  assert.equal(r.documents, 1, "the shopping list is no statement");
  assert.equal(listTransactions().length, before + 1);
  assert.equal(importStatementDocuments().documents, 0, "once");
});
