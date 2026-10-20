import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const IBAN = "DE22 6609 0800 0007 7773 02";

async function seed() {
  const { setInstalled } = await import("@/plugins/state");
  for (const p of ["people", "todos", "cases"]) setInstalled(p, true);
  const { createPerson, listPeople } = await import("@/plugins/people/store");
  const had = listPeople().find((p) => p.name === "Ulla Nathanael");
  if (had) return { ogv: had.id };
  const { addClaim } = await import("@/plugins/people/graph");
  const ogv = createPerson({ name: "Ulla Nathanael", emails: ["ogv.nathanael@gvjustiz.de"] });
  addClaim({ personId: ogv, kind: "fact", text: `Dienstkonto: Empfänger Nathanael Dienstkonto, IBAN ${IBAN}, BIC GENODE61BBB, Bank BBBank Karlsruhe; Verfahren DR II 810/26 und DR II 1121/26.`, evidence: "IBAN", sourceRef: "doc:1", confidence: 0.9 });
  const { syncDetails } = await import("@/plugins/people/details");
  syncDetails(ogv);
  return { ogv };
}

test("bank-transfer: an action like any — its account checked, its click opens the GiroCode", async () => {
  const { CASES_ACTIONS } = await import("@/plugins/cases/actions");
  const a = CASES_ACTIONS.find((x) => x.type === "bank-transfer")!;
  const op = a.clean({ name: "Nathanael Dienstkonto", iban: IBAN, bic: "GENODE61BBB", amount: "11,52", purpose: "DR II 810/26" }, { ticket: "" })!;
  assert.deepEqual(op, { type: "bank-transfer", name: "Nathanael Dienstkonto", iban: IBAN, bic: "GENODE61BBB", amount: "11.52", purpose: "DR II 810/26" });
  assert.equal(a.clean({ name: "X", iban: "DE23 6609 0800 0007 7773 02" }, { ticket: "" }), null, "a wrong IBAN is no transfer");
  assert.match(a.href!(op), /^\/pay\?/);
  assert.match(decodeURIComponent(a.href!(op)), /amount=11\.52/);
  assert.match(a.title(op), /11[.,]52/);
  assert.ok(a.offer, "the AI may propose it");
});

test("payments: the todos that are payments get a transfer of their own (no AI) — once; one that names nobody with an account none", async () => {
  await seed();
  const { getDb, schema } = await import("@/db");
  const now = new Date().toISOString();
  const add = (text: string) => getDb().insert(schema.todos).values({ ticket: "KB-2", text, kind: "other", owner: "me", status: "open", source: "Mail", refs: "[]", ops: JSON.stringify([{ type: "calendar-entry", calendar: "", title: "x", start: "2026-10-20T19:00", minutes: 15, body: "" }]), createdAt: now, updatedAt: now } as never).returning().get() as { id: number };
  const pay = add("Restforderung 11,52 € (Az. DR II 810/26) heute auf das Dienstkonto der Gerichtsvollzieherin überweisen");
  const other = add("Bei der Bank 20 € Gebühr nachfragen");
  const { attachPayments } = await import("@/plugins/cases/payments");
  assert.equal(attachPayments(), 1);
  const { getTodo } = await import("@/lib/boards/store");
  const ops = getTodo(pay.id)!.ops;
  assert.deepEqual(ops.map((o) => o.type), ["calendar-entry", "bank-transfer"], "added, the others kept");
  const transfer = ops[1] as { name: string; iban: string; amount: string; purpose: string };
  assert.deepEqual([transfer.name, transfer.iban, transfer.amount, transfer.purpose], ["Nathanael Dienstkonto", IBAN, "11.52", "DR II 810/26"]);
  assert.equal(getTodo(other.id)!.ops.some((o) => o.type === "bank-transfer"), false);
  assert.equal(attachPayments(), 0, "not twice");
});

test("cases: the payment of a case not summed up yet is its person's account, with the case number as purpose", async () => {
  const { ogv } = await seed();
  const { ensureCase, updateCase } = await import("@/plugins/cases/store");
  const c = ensureCase("DR II 1121/26", "DR II 1121/26", new Date().toISOString());
  updateCase(c.id, { personId: ogv });
  const { casePayment } = await import("@/plugins/cases/payments");
  const p = casePayment(c.id)!;
  assert.deepEqual([p.name, p.iban, p.bic, p.purpose], ["Nathanael Dienstkonto", IBAN, "GENODE61BBB", "DR II 1121/26"]);
  assert.equal(p.amount, null);
});

test("cases: the payee the AI names is the account holder — a bank in brackets after it dropped", async () => {
  const { checked } = await import("@/plugins/cases/compile");
  assert.equal(checked({ payee: "Nathanael Dienstkonto (BBBank Karlsruhe)" }, "DR II 1/26", 1).payee, "Nathanael Dienstkonto");
});
