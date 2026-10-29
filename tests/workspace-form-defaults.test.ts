import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

// A form straight from a table (every column it can ask, the title first), offered as "New with a form …" for a database with
// enough columns, and every "new row" of a view (a board column, a calendar day, a group) prefilling the entry form with its value.
setupTempData();

async function world() {
  const { setInstalled } = await import("@/plugins/state");
  for (const p of ["workspace", "people"]) setInstalled(p, true);
  const w = await import("@/plugins/workspace/store");
  const folder = w.createPage({ title: "Projekte" });
  const db = w.createPage({ kind: "database", title: "Aufgaben", parentId: folder });
  w.updateSchema(db, {
    ...w.getDatabase(db)!.schema,
    titleName: "Aufgabe",
    properties: [
      { id: "status", name: "Status", type: "status", options: [{ id: "s1", name: "Neu", color: "gray" }, { id: "s2", name: "Fertig", color: "green" }] },
      { id: "notiz", name: "Notiz", type: "markdown" },
      { id: "faellig", name: "Fällig", type: "date" },
      { id: "menge", name: "Menge", type: "number" },
      { id: "wer", name: "Wer", type: "person" },
      { id: "tags", name: "Tags", type: "multi_select", options: [{ id: "t1", name: "Web", color: "blue" }] },
      { id: "summe", name: "Summe", type: "formula", formula: "1+1" },
    ],
  });
  return { w, db, folder };
}

test("a form from a table: every column it can ask, the title first and required, short types half wide", async () => {
  const { w, db } = await world();
  const { tableFormDef, formProps } = await import("@/plugins/workspace/form-spec");
  const def = tableFormDef(db, formProps(w.getDatabase(db)!.schema));
  assert.equal(def.dbId, db);
  assert.equal(def.steps.length, 1);
  const fields = def.steps[0].items.map((i) => (i.kind === "field" ? [i.prop, i.width, !!i.required] : [i.kind]));
  assert.deepEqual(fields, [
    ["title", "full", true],
    ["status", "half", false],
    ["notiz", "full", false],
    ["faellig", "half", false],
    ["menge", "half", false],
    ["wer", "half", false],
    ["tags", "full", false],
  ], "no formula — it can't be asked");
});

test("“Make a form from this table”: a form page beside the database, its entry form when it had none — never replacing one", async () => {
  const { w, db, folder } = await world();
  const { formFromTable, getForm } = await import("@/plugins/workspace/forms");
  const id = formFromTable(db);
  const page = w.getPage(id)!;
  assert.equal(page.kind, "form");
  assert.equal(page.parentId, folder, "beside the database");
  assert.equal(page.title, "Aufgaben – Form");
  assert.equal(getForm(id)!.def.steps[0].items.length, 7);
  assert.equal(w.getDatabase(db)!.schema.entryForm, id, "the entry form now");
  const second = formFromTable(db);
  assert.notEqual(second, id);
  assert.equal(w.getDatabase(db)!.schema.entryForm, id, "the entry form set before stays");
  assert.throws(() => formFromTable(999999), /No such database/);
});

test("“New with a form …” is offered with 3 or more columns to ask and no entry form", async () => {
  const { w, db } = await world();
  const { offersEntryForm } = await import("@/plugins/workspace/form-spec");
  assert.equal(offersEntryForm(w.getDatabase(db)!.schema), true);
  const small = w.createPage({ kind: "database", title: "Klein" });
  const s = w.getDatabase(small)!.schema;
  assert.equal(offersEntryForm({ ...s, properties: [{ id: "a", name: "A", type: "text" }] }), false, "the title and one column: too few");
  assert.equal(offersEntryForm({ ...s, properties: [{ id: "a", name: "A", type: "text" }, { id: "b", name: "B", type: "formula", formula: "1" }] }), false, "a formula isn't asked");
  assert.equal(offersEntryForm({ ...s, properties: [{ id: "a", name: "A", type: "text" }, { id: "b", name: "B", type: "number" }] }), true);
  assert.equal(offersEntryForm({ ...w.getDatabase(db)!.schema, entryForm: 5 }), false, "it has one already");
});

test("a view's context as the form's first answers: as the fields hold them, only fields the form asks", async () => {
  const { w, db } = await world();
  const { tableFormDef, formProps, prefillAnswers, fieldItem } = await import("@/plugins/workspace/form-spec");
  const props = formProps(w.getDatabase(db)!.schema);
  const def = tableFormDef(db, props);
  assert.deepEqual(prefillAnswers(def, props, { status: "s2" }), { status: "s2" }, "a board column: its status");
  assert.deepEqual(prefillAnswers(def, props, { faellig: "2026-10-29" }), { faellig: "2026-10-29" }, "a calendar day: its date");
  assert.deepEqual(prefillAnswers(def, props, { faellig: "2026-10-29T10:10" }), { faellig: "2026-10-29" }, "a date input takes the day");
  assert.deepEqual(prefillAnswers(def, props, { faellig: { start: "2026-11-02", end: "2026-11-03" } }), { faellig: "2026-11-02" });
  assert.deepEqual(prefillAnswers(def, props, { wer: [4], tags: ["t1"], menge: 3 }), { wer: [4], tags: ["t1"], menge: "3" }, "a group: lists stay lists, a number as words");
  assert.deepEqual(prefillAnswers(def, props, { wer: 4, tags: "t1" }), { wer: [4], tags: ["t1"] }, "one value for a list field");
  assert.deepEqual(prefillAnswers(def, props, { status: "nope", menge: null, wer: [], summe: 2, gone: "x" }), {}, "no option that isn't one, nothing blank, nothing the form doesn't ask");
  const hiddenStatus = { ...def, steps: [{ ...def.steps[0], items: [fieldItem("title"), fieldItem("status", { hidden: true, default: "Neu" })] }] };
  assert.deepEqual(prefillAnswers(hiddenStatus, props, { status: "s2" }), {}, "a field not asked isn't answered");
});

test("sent with its context: what the form doesn't ask comes from the context (over a hidden default), what it asks from the answers", async () => {
  const { w, db } = await world();
  const { createForm, submitForm } = await import("@/plugins/workspace/forms");
  const { fieldItem, newStep } = await import("@/plugins/workspace/form-spec");
  const id = createForm({ dbId: db, def: { dbId: db, title: "", intro: "", submitLabel: "", thanks: "", steps: [{ ...newStep(), items: [fieldItem("title", { required: true }), fieldItem("faellig"), fieldItem("status", { hidden: true, default: "Neu" })] }] } });
  const r = submitForm(id, { title: "Neu im Board", faellig: "" }, { status: "s2", faellig: "2026-10-29", menge: 2, summe: 9 });
  assert.deepEqual(r.errors, {});
  const row = w.rawRows(db).find((x) => x.id === r.id)!;
  assert.equal(row.title, "Neu im Board");
  assert.equal(row.cells.status, "s2", "the board column's status, not the hidden default");
  assert.equal(row.cells.faellig, undefined, "a field the form asks: its answer (emptied) counts");
  assert.equal(row.cells.menge, 2, "a column the form doesn't ask");
  assert.equal(row.cells.summe, undefined, "a formula is never set");
  const plain = submitForm(id, { title: "Ohne" });
  assert.equal(w.rawRows(db).find((x) => x.id === plain.id)!.cells.status, "s1", "without a context: the hidden default");
});

test("chosen people and rows by name: a default or a prefill shows names, not ids", async () => {
  const { w, db } = await world();
  const { createPerson } = await import("@/plugins/people/store");
  const { pickedLabels } = await import("@/plugins/workspace/forms");
  const anna = createPerson({ name: "Anna" });
  assert.deepEqual(pickedLabels(db, "wer", [anna, 99999]), { [anna]: "Anna" }, "who is gone: no name");
  const kunden = w.createPage({ kind: "database", title: "Kunden" });
  const acme = w.addRow(kunden, { title: "Acme" });
  w.updateSchema(db, { ...w.getDatabase(db)!.schema, properties: [...w.getDatabase(db)!.schema.properties, { id: "kunde", name: "Kunde", type: "relation", relationDb: kunden }] });
  assert.deepEqual(pickedLabels(db, "kunde", [acme, db]), { [acme]: "Acme" }, "only rows of the related database");
  assert.deepEqual(pickedLabels(db, "notiz", [anna]), {}, "no person or relation field");
});
