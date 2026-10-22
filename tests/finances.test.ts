import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const day = (d: number) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);

async function setup() {
  const { setInstalled } = await import("@/plugins/state");
  for (const p of ["workspace", "people", "todos", "cases", "finances"]) setInstalled(p, true);
  await import("@/plugins/contributions");
}

test("the debts database: made once — your own debts kept as cases before move in as rows (the cases set aside), the cases with money open come by themselves, their figures locked", async () => {
  await setup();
  const { createPerson } = await import("@/plugins/people/store");
  const { ensureCase, updateCase, getCase } = await import("@/plugins/cases/store");
  const { checked } = await import("@/plugins/cases/compile");
  const { setParty } = await import("@/plugins/cases/parties");
  const chris = createPerson({ name: "Chris Ballhaus" });
  // An own debt as the cases kept it before (MAN-…).
  const man = ensureCase("MAN-1", "Geliehen für die Reparatur", new Date().toISOString()).id;
  updateCase(man, { personId: chris, compiled: { ...checked({ title: "Geliehen für die Reparatur", open: 150, total: 150, installment: 50, next_due: day(20) }, "MAN-1", 0), manual: true } });
  setParty(man, "creditor", chris, "manual");
  // A case from letters, with money open.
  const spk = createPerson({ name: "Sparkasse Freiburg" });
  const c = ensureCase("DR II 1121/26", "DR II 1121/26", new Date().toISOString()).id;
  updateCase(c, { compiled: checked({ title: "Sparkasse – Ratenplan", creditor: "Sparkasse Freiburg", open: 3618.13, total: 3618.13, installment: 300, next_due: day(5), installment_day: 15 }, "DR II 1121/26", 2) });
  setParty(c, "creditor", spk, "ai");
  const { ensureDebtsDatabase } = await import("@/plugins/finances/database");
  const db = (await ensureDebtsDatabase())!;
  assert.ok(db);
  assert.equal(await ensureDebtsDatabase(), db, "made once");
  assert.equal(getCase(man)!.status, "ignored", "the old case set aside, not deleted");
  const { rawRows, setCell, getDatabase } = await import("@/plugins/workspace/store");
  assert.equal(getDatabase(db)!.schema.dataType, "debts");
  const rows = rawRows(db);
  const own = rows.find((r) => r.title === "Geliehen für die Reparatur")!;
  assert.ok(own && !own.cells.srcref, "a row of your own");
  assert.deepEqual(own.cells.debtcreditor, [chris]);
  assert.equal(own.cells.debtopen, 150);
  const fromCase = rows.find((r) => r.cells.srcref === `case:${c}`)!;
  assert.ok(fromCase, "the case's debt came by itself");
  assert.deepEqual(fromCase.cells.debtcreditor, [spk]);
  assert.equal(fromCase.cells.debtopen, 3618.13);
  assert.throws(() => setCell(fromCase.id, "debtopen", 1), /source|Quelle|isn't changed/i, "a case's figures are its letters'");
  setCell(own.id, "debtopen", 120);
  assert.equal(rawRows(db).find((r) => r.id === own.id)!.cells.debtopen, 120, "your own row is yours");
});

test("debts and claims of your own: written down to a contact (or a new one), changed, a field emptied, removed — a case's row isn't", async () => {
  await setup();
  const { createDebt, setDebtMoney, deleteDebt } = await import("@/plugins/finances/own");
  const { rawRows, getPage } = await import("@/plugins/workspace/store");
  const { debtsDbId } = await import("@/plugins/finances/debts");
  const db = debtsDbId()!;
  const id = createDebt({ title: "Stromrechnung", creditorName: "Badenova AG", creditorKind: "organization", amount: 186.83, due: day(10), installment: null });
  const claim = createDebt({ dir: "owed", title: "Konzertkarte", creditorName: "Max Muster", creditorKind: "person", amount: 60, due: null, installment: null });
  const row = () => rawRows(db).find((r) => r.id === id)!;
  assert.equal(row().cells.debtdir, "owe");
  assert.equal(rawRows(db).find((r) => r.id === claim)!.cells.debtdir, "owed");
  setDebtMoney(id, { installment: 50, day: 15 });
  assert.equal(row().cells.debtrate, 50);
  setDebtMoney(id, { due: null, installment: null });
  assert.equal(row().cells.debtdue ?? null, null, "emptied: gone");
  assert.equal(row().cells.debtrate ?? null, null);
  deleteDebt(id);
  assert.ok(getPage(id)?.archivedAt, "removed (to the bin)");
  const caseRow = rawRows(db).find((r) => r.cells.srcref)!;
  assert.throws(() => setDebtMoney(caseRow.id, { open: 1 }), /case/i);
  assert.throws(() => deleteDebt(caseRow.id), /case/i);
});

test("the plans by direction: what you owe (the case and yours), what you are owed; the balance with each contact", async () => {
  await setup();
  const { debtPlans, balances } = await import("@/plugins/finances/debts");
  const owe = debtPlans(day(0), "owe");
  assert.deepEqual(owe.debts.map((d) => d.creditor).sort(), ["Chris Ballhaus", "Sparkasse Freiburg"]);
  const spk = owe.debts.find((d) => d.creditor === "Sparkasse Freiburg")!;
  assert.equal(spk.manual, false);
  assert.equal(spk.plan.kind, "plan");
  assert.equal(spk.plan.payments[1].date.slice(8), "15", "the plan's day as the AI read it");
  assert.equal(owe.summary.monthlyRates, 350, "300 + 50");
  const owed = debtPlans(day(0), "owed");
  assert.deepEqual(owed.debts.map((d) => [d.creditor, d.open]), [["Max Muster", 60]]);
  const { listPeople } = await import("@/plugins/people/store");
  const max = listPeople().find((p) => p.name === "Max Muster")!.id;
  const chris = listPeople().find((p) => p.name === "Chris Ballhaus")!.id;
  assert.deepEqual(balances().get(max), { owe: 0, owed: 60 });
  assert.deepEqual(balances().get(chris), { owe: 120, owed: 0 });
});

test("promises offered: yours with an amount as a debt, theirs as a claim — not when a debt or a case covers it, not twice", async () => {
  await setup();
  const { createPerson } = await import("@/plugins/people/store");
  const { addClaim } = await import("@/plugins/people/graph");
  const { debtSuggestions, createDebtFromClaim } = await import("@/plugins/finances/own");
  const jo = createPerson({ name: "Johanna Roessler" });
  const lea = createPerson({ name: "Lea Lustig" });
  const { listPeople } = await import("@/plugins/people/store");
  const chris = listPeople().find((p) => p.name === "Chris Ballhaus")!.id;
  addClaim({ personId: jo, kind: "commitment", text: "Ich habe Johanna zugesagt, ihr die 200€ in 9 Tagen zurückzuüberweisen.", direction: "mine", due: day(9), confidence: 0.9 });
  addClaim({ personId: lea, kind: "commitment", text: "Lea zahlt mir die 50 € fürs Essen zurück.", direction: "theirs", confidence: 0.9 });
  addClaim({ personId: chris, kind: "commitment", text: "Ich zahle Chris die 150 € zurück.", direction: "mine", confidence: 0.9 });
  addClaim({ personId: jo, kind: "commitment", text: "Ich rufe sie morgen an.", direction: "mine", confidence: 0.9 });
  const s = debtSuggestions();
  assert.deepEqual(s.map((x) => [x.name, x.dir, x.amount]).sort(), [["Johanna Roessler", "owe", 200], ["Lea Lustig", "owed", 50]], "Chris has a debt already");
  createDebtFromClaim(s.find((x) => x.name === "Lea Lustig")!.claimId);
  assert.deepEqual(debtSuggestions().map((x) => x.name), ["Johanna Roessler"], "taken");
});

test("fixed costs: the value published as Fixkosten (a sum in a database of yours) — none published: none", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("workspace", true);
  const { fixedCosts } = await import("@/plugins/finances/fixed");
  assert.deepEqual(fixedCosts(), { amount: null, agg: null, items: [] });
  const { createPage, addRow, getDatabase } = await import("@/plugins/workspace/store");
  const { newProperty, newView } = await import("@/plugins/workspace/model");
  const amount = newProperty("Betrag", "number");
  const db = createPage({ kind: "database", title: "Monatskosten", schema: { titleName: "Posten", properties: [amount], views: [newView("Alle", "table")] } });
  addRow(db, { title: "Miete", cells: { [amount.id]: 650 } });
  addRow(db, { title: "Handy", cells: { [amount.id]: 15.5 } });
  const { publishValue } = await import("@/plugins/workspace/values");
  publishValue({ label: "Fixkosten", dbId: db, viewId: getDatabase(db)!.schema.views[0].id, propId: amount.id, fn: "sum" });
  const f = fixedCosts();
  assert.equal(f.amount, 665.5);
  // The items read from where the type says they are — each row with its database, a colour each.
  assert.deepEqual(f.items.map((i) => [i.title, i.amount, i.source]), [["Miete", 650, "Monatskosten"], ["Handy", 15.5, "Monatskosten"]]);
  assert.equal(new Set(f.items.map((i) => i.color)).size, 2);
});
