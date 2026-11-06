import assert from "node:assert/strict";
import test, { before } from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

before(async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const p of ["workspace", "people", "todos", "cases", "finances"]) setInstalled(p, true);
  await (await import("@/plugins/finances/database")).ensureDebtsDatabase();
});

test("two profiles become one: a debt's other side, a case's parties and a person field follow — also a closed or archived row", async () => {
  const { createPerson, mergePeople, getPerson } = await import("@/plugins/people/store");
  const { createPage, addRow, rawRows, archivePage } = await import("@/plugins/workspace/store");
  const { getSqlite } = await import("@/db");
  const { casesDb } = await import("@/plugins/cases/store");
  const { partiesOf, setParty } = await import("@/plugins/cases/parties");
  const { createDebt } = await import("@/plugins/finances/own");
  const { debtPlans } = await import("@/plugins/finances/debts");

  const chris = createPerson({ name: "Chris" });
  const other = createPerson({ name: "Christoph Widder" });
  const third = createPerson({ name: "Anna" });

  const debt = createDebt({ dir: "owed", title: "geliehen um über die Runden zu kommen", creditorId: other, amount: 500, due: null, installment: null });

  const d = casesDb();
  const caseId = Number(d.prepare("insert into cases (key, label, person_id, created_at, updated_at, last_at) values ('k1', 'Fall', ?, '2026-01-01', '2026-01-01', '2026-01-01')").run(other).lastInsertRowid);
  setParty(caseId, "creditor", other, "manual");

  const db = createPage({ parentId: null, title: "Leute", kind: "database", schema: { titleName: "Name", properties: [{ id: "who", name: "Wer", type: "person" }], views: [{ id: "v", name: "Liste", type: "table", filter: { op: "and", rules: [] }, sorts: [], hidden: [] }] } });
  const both = addRow(db, { title: "beide", cells: { who: [chris, other, third] } });
  const gone = addRow(db, { title: "im Papierkorb", cells: { who: [other] } });
  const untouched = addRow(db, { title: "andere", cells: { who: [third] } });
  archivePage(gone);

  mergePeople(chris, other);

  assert.equal(getPerson(other), null);
  const plan = debtPlans(undefined, "owed").debts.find((x) => x.id === debt)!;
  assert.equal(plan.creditor, "Chris", "the merged person, not the debt's title");
  assert.equal(plan.creditorId, chris);
  assert.equal(partiesOf(caseId).creditor?.personId, chris);
  assert.equal((d.prepare("select person_id from cases where id = ?").get(caseId) as { person_id: number }).person_id, chris);
  const rows = rawRows(db);
  assert.deepEqual(rows.find((r) => r.id === both)!.cells.who, [chris, third], "one name, once");
  assert.deepEqual(rows.find((r) => r.id === untouched)!.cells.who, [third]);
  assert.match((getSqlite().prepare("select props from ws_pages where id = ?").get(gone) as { props: string }).props, new RegExp(`"who":\\[${chris}\\]`), "the archived row too");
});

test("a debt's other side can be changed: yours in its row, a contact that is new is made", async () => {
  const { createPerson, listPeople } = await import("@/plugins/people/store");
  const { createDebt, setDebtSide } = await import("@/plugins/finances/own");
  const { debtPlans } = await import("@/plugins/finances/debts");
  const a = createPerson({ name: "Bea" });
  const b = createPerson({ name: "Carl" });
  const id = createDebt({ dir: "owe", title: "Miete", creditorId: a, amount: 100, due: null, installment: null });
  setDebtSide(id, { creditorId: b });
  assert.equal(debtPlans(undefined, "owe").debts.find((x) => x.id === id)!.creditor, "Carl");
  setDebtSide(id, { creditorName: "Neue Bank", creditorKind: "organization" });
  assert.equal(debtPlans(undefined, "owe").debts.find((x) => x.id === id)!.creditor, "Neue Bank");
  assert.ok(listPeople().some((p) => p.name === "Neue Bank"));
  assert.throws(() => setDebtSide(999999, { creditorId: b }), /No such debt/);
});
