import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

// Forms as pages of their own (kind "form"): what one asks is kept in the page (normalized), filled in it makes a row — the server
// checks it again: required among the fields that show, conditions worked out, choices among the options, defaults of what isn't asked.
setupTempData();

async function world() {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("workspace", true);
  const w = await import("@/plugins/workspace/store");
  const kunden = w.createPage({ kind: "database", title: "Kunden" });
  const anna = w.addRow(kunden, { title: "Anna GmbH" });
  const db = w.createPage({ kind: "database", title: "Anfragen" });
  w.updateSchema(db, {
    ...w.getDatabase(db)!.schema,
    titleName: "Betreff",
    properties: [
      { id: "art", name: "Art", type: "select", options: [{ id: "o1", name: "Frage", color: "gray" }, { id: "o2", name: "Fehler", color: "red" }] },
      { id: "schritte", name: "Schritte", type: "markdown" },
      { id: "tags", name: "Tags", type: "multi_select", options: [{ id: "t1", name: "Web", color: "blue" }, { id: "t2", name: "App", color: "green" }] },
      { id: "menge", name: "Menge", type: "number" },
      { id: "mail", name: "E-Mail", type: "email" },
      { id: "quelle", name: "Quelle", type: "text" },
      { id: "kunde", name: "Kunde", type: "relation", relationDb: kunden },
      { id: "summe", name: "Summe", type: "formula", formula: "1+1" },
      { id: "ok", name: "Einverstanden", type: "checkbox" },
    ],
  });
  return { w, db, kunden, anna };
}

test("a form as it is kept: known parts only, words bounded, a property asked once, conditions only on another field of the form", async () => {
  const { normalizeForm, formProps } = await import("@/plugins/workspace/form-spec");
  const { w, db } = await world();
  const props = formProps(w.getDatabase(db)!.schema);
  assert.deepEqual(props.map((p) => p.id), ["title", "art", "schritte", "tags", "menge", "mail", "quelle", "kunde", "ok"], "the title first; a formula can't be asked");
  const def = normalizeForm(
    {
      dbId: db,
      title: "x".repeat(500),
      evil: 1,
      steps: [
        {
          id: "s1",
          title: "Eins",
          items: [
            { id: "a", kind: "field", prop: "title", required: true, width: "half", label: "Worum geht es?", when: { prop: "title", op: "filled" } },
            { id: "a", kind: "field", prop: "art", width: "weird", when: { prop: "nope", op: "eq", value: "x" } },
            { id: "c", kind: "field", prop: "art" },
            { id: "d", kind: "field", prop: "schritte", when: { prop: "art", op: "eq", value: "o2" }, hidden: true, required: true, default: "y" },
            { id: "e", kind: "field", prop: "summe" },
            { id: "f", kind: "heading", text: "Kontakt", prop: "x" },
            { id: "g", kind: "video" },
            { kind: "divider" },
          ],
        },
      ],
    },
    props,
  );
  assert.equal(def.title.length, 200);
  assert.equal("evil" in def, false);
  const items = def.steps[0].items;
  assert.deepEqual(items.map((i) => i.kind + (i.kind === "field" ? `:${i.prop}` : "")), ["field:title", "field:art", "field:schritte", "heading", "divider"], "art once, a formula and an unknown kind dropped");
  const [title, art, , , divider] = items as [import("@/plugins/workspace/form-spec").FieldItem, import("@/plugins/workspace/form-spec").FieldItem, unknown, unknown, { id: string }];
  assert.equal(title.when, undefined, "no condition on itself");
  assert.equal(title.width, "half");
  assert.equal(art.when, undefined, "no condition on a field that isn't on the form");
  assert.equal(art.width, "full");
  assert.notEqual(art.id, title.id, "ids unique");
  assert.match(divider.id, /^[\w-]+$/, "an id given");
  assert.deepEqual(normalizeForm(null).steps.length, 1, "always a step");
  assert.equal(normalizeForm({ dbId: -3 }).dbId, null);
  const hidden = normalizeForm({ steps: [{ items: [{ kind: "field", prop: "art", hidden: true, required: true }] }] }).steps[0].items[0];
  assert.equal("required" in hidden, false, "a field not asked isn't required");
});

test("sending a form: required among the fields that show, a condition hides a required field, choices only from the options, hidden defaults set", async () => {
  const { w, db, anna, kunden } = await world();
  const { createForm, saveForm, submitForm, getForm } = await import("@/plugins/workspace/forms");
  const id = createForm({ dbId: db });
  assert.equal(w.getPage(id)!.kind, "form");
  assert.equal(w.getPage(id)!.title, "Anfragen – Form");
  saveForm(id, {
    dbId: db,
    title: "Anfrage",
    steps: [
      {
        id: "s1",
        title: "",
        items: [
          { id: "t", kind: "field", prop: "title", required: true },
          { id: "a", kind: "field", prop: "art", required: true },
          { id: "s", kind: "field", prop: "schritte", required: true, when: { prop: "art", op: "eq", value: "o2" } },
          { id: "g", kind: "field", prop: "tags" },
          { id: "m", kind: "field", prop: "menge" },
          { id: "e", kind: "field", prop: "mail" },
          { id: "q", kind: "field", prop: "quelle", hidden: true, default: "Formular" },
          { id: "k", kind: "field", prop: "kunde" },
          { id: "x", kind: "field", prop: "summe" },
        ],
      },
    ],
  });
  assert.equal(getForm(id)!.def.steps[0].items.length, 8, "the formula is no field of a form");
  const rowOf = (rid: number) => w.rawRows(db).find((r) => r.id === rid)!;

  // A question: the steps to reproduce don't show, so they aren't required — and what was typed into them is not kept.
  const q = submitForm(id, { title: "Wie geht das?", art: "o1", schritte: "geheim", quelle: "gefälscht" });
  assert.deepEqual(q.errors, {});
  assert.equal(rowOf(q.id!).cells.schritte, undefined, "a hidden field's value is not sent");
  assert.equal(rowOf(q.id!).cells.quelle, "Formular", "the default of a field not asked — never what was sent for it");

  // A bug: now the steps show and are required.
  const bug = submitForm(id, { title: "Absturz", art: "Fehler" });
  assert.deepEqual(Object.keys(bug.errors), ["s"]);
  assert.equal(bug.id, null);
  assert.match(bug.errors.s, /Schritte/);
  const fixed = submitForm(id, { title: "Absturz", art: "o2", schritte: "1. Öffnen", tags: ["t2", "Web"], menge: "2,5", mail: "a@b.de", kunde: [anna] });
  assert.deepEqual(fixed.errors, {});
  const cells = rowOf(fixed.id!).cells;
  assert.deepEqual([cells.art, cells.schritte, cells.tags, cells.menge, cells.mail, cells.kunde], ["o2", "1. Öffnen", ["t2", "t1"], 2.5, "a@b.de", [anna]]);

  // What doesn't fit: an option that isn't one, a number that isn't, an address that isn't, a row of another database, the title missing.
  const bad = submitForm(id, { title: " ", art: "Dringend", tags: ["t9"], menge: "viel", mail: "nope", kunde: [db] });
  assert.deepEqual(Object.keys(bad.errors).sort(), ["a", "e", "g", "k", "m", "t"]);
  assert.match(bad.errors.t, /Betreff/);
  assert.equal(w.rawRows(db).length, 2, "nothing made");
  assert.equal(w.rawRows(kunden).length, 1);
});

test("a wizard: every step is checked on the server, a condition on a field of an earlier step works, a field not asked holds its value for conditions", async () => {
  const { w, db } = await world();
  const { createForm, submitForm } = await import("@/plugins/workspace/forms");
  const { formErrors } = await import("@/plugins/workspace/form-spec");
  const id = createForm({
    dbId: db,
    def: {
      dbId: db,
      title: "Assistent",
      intro: "",
      submitLabel: "Absenden",
      thanks: "",
      steps: [
        { id: "s1", title: "Worum", items: [{ id: "t", kind: "field", prop: "title", required: true, width: "full" }, { id: "a", kind: "field", prop: "art", hidden: true, default: "Fehler", width: "full" }] },
        { id: "s2", title: "Details", items: [{ id: "s", kind: "field", prop: "schritte", required: true, width: "full", when: { prop: "art", op: "eq", value: "Fehler" } }, { id: "o", kind: "field", prop: "ok", required: true, width: "half" }] },
      ],
    },
  });
  const r = submitForm(id, { title: "Hallo" });
  assert.deepEqual(Object.keys(r.errors).sort(), ["o", "s"], "the second step's required fields (the hidden default makes the condition hold)");
  assert.match(r.errors.o, /tick/i);
  const ok = submitForm(id, { title: "Hallo", schritte: "So", ok: true });
  const row = w.rawRows(db).find((x) => x.id === ok.id)!;
  assert.deepEqual([row.title, row.cells.art, row.cells.schritte, row.cells.ok], ["Hallo", "o2", "So", true]);

  // The browser checks one step at a time with the same rules.
  const { getForm } = await import("@/plugins/workspace/forms");
  const form = getForm(id)!;
  const t = (s: string, v?: Record<string, unknown>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v?.[k] ?? ""));
  assert.deepEqual(Object.keys(formErrors(form.def, {}, form.db!.props, t, "s1")), ["t"]);
  assert.deepEqual(Object.keys(formErrors(form.def, { title: "x" }, form.db!.props, t, "s1")), []);
});

test("a form page: no database yet, another chosen (its fields leave), entry form of a database, the forms of a database, a copy", async () => {
  const { w, db } = await world();
  const f = await import("@/plugins/workspace/forms");
  const blank = w.createPage({ kind: "form", title: "Leer" });
  assert.equal(f.getForm(blank)!.db, null);
  assert.throws(() => f.submitForm(blank, {}), /database/i);
  assert.throws(() => f.saveForm(blank, { dbId: 999999 }), /database/i);
  const other = w.createPage({ kind: "database", title: "Andere" });
  const saved = f.saveForm(blank, { dbId: other, steps: [{ items: [{ kind: "field", prop: "art" }, { kind: "field", prop: "title" }, { kind: "heading", text: "H" }] }] });
  assert.deepEqual(saved.def.steps[0].items.map((i) => i.kind), ["field", "heading"], "a field the database doesn't have leaves");
  const mine = f.createForm({ dbId: db, title: "Meins" });
  assert.deepEqual(f.formsOfDb(db).map((x) => x.title), ["Meins"]);
  assert.equal(f.relationChoices(db, "kunde", "ann")[0]?.label, "Anna GmbH");
  assert.deepEqual(f.relationChoices(db, "art", ""), [], "only a relation");
  const { setEntryFormAction } = await import("@/plugins/workspace/actions");
  assert.equal((await setEntryFormAction(db, blank)).ok, false, "a form of another database can't be its entry form");
  assert.equal((await setEntryFormAction(db, mine)).ok, true);
  assert.equal(w.getDatabase(db)!.schema.entryForm, mine);
  await setEntryFormAction(db, null);
  assert.equal(w.getDatabase(db)!.schema.entryForm, undefined);
  const copy = w.duplicatePage(mine);
  assert.equal(f.getForm(copy)!.def.dbId, db, "a copy asks the same");
  assert.equal(w.tree().find((x) => x.id === mine)!.kind, "form");
});

test("the form block in a page: kept to what it can be, and as Markdown both ways", async () => {
  const { sanitizeDoc, docToMarkdown, markdownToDoc } = await import("@/plugins/workspace/doc");
  const doc = sanitizeDoc({ type: "doc", content: [{ type: "zeffForm", attrs: { formId: "12", dbId: 5, fields: '["a"]', label: "x" } }, { type: "zeffForm", attrs: { formId: null } }, { type: "zeffForm", attrs: { dbId: 5, fields: '["a","b"]', label: "Senden" } }] }) as { content: { attrs?: Record<string, unknown> }[] };
  assert.deepEqual(doc.content.map((n) => n.attrs), [{ formId: 12 }, { formId: null }, { dbId: 5, fields: '["a","b"]', label: "Senden" }], "a form page wins over an old block's attributes");
  const md = docToMarkdown(doc as never);
  assert.match(md, /^:::form 12$/m);
  assert.match(md, /^:::form$/m);
  assert.match(md, /^:::form \{"dbId":5,"fields":\["a","b"\],"label":"Senden"\}$/m);
  const back = sanitizeDoc(markdownToDoc(md)) as { content: { type: string; attrs?: Record<string, unknown> }[] };
  assert.deepEqual(back.content.filter((n) => n.type === "zeffForm").map((n) => n.attrs), doc.content.map((n) => n.attrs), "round trip");
});

test("an old form block becomes a form page below its page, asking the title and its fields", async () => {
  const { w, db } = await world();
  const f = await import("@/plugins/workspace/forms");
  const page = w.createPage({ title: "Cockpit" });
  const id = f.convertLegacyBlock(page, db, ["art", "menge", "nope"], "Melden");
  const form = f.getForm(id)!;
  assert.equal(w.getPage(id)!.parentId, page);
  assert.equal(form.def.submitLabel, "Melden");
  assert.deepEqual(form.def.steps[0].items.map((i) => (i.kind === "field" ? `${i.prop}${i.required ? "*" : ""}` : i.kind)), ["title*", "art", "menge"]);
});

test("rows and columns: kept nested (3 deep at most, empty ones too), their fields checked by the server, conditions on them, their cells collected", async () => {
  const { normalizeForm, formProps, formFields, flatItems } = await import("@/plugins/workspace/form-spec");
  const { w, db } = await world();
  const props = formProps(w.getDatabase(db)!.schema);
  const box = (dir: string, items: unknown[]) => ({ kind: "flex", dir, items });
  const deep = normalizeForm({ steps: [{ items: [box("row", [box("col", [box("row", [box("col", [{ kind: "field", prop: "menge" }])])]), box("col", [])]), { kind: "flex", dir: "diagonal", gap: "xl", items: "nope" }] }] }, props);
  const [row, odd] = deep.steps[0].items as import("@/plugins/workspace/form-spec").FlexItem[];
  assert.deepEqual([row.dir, odd.dir, odd.gap, odd.items], ["row", "row", undefined, []], "an unknown direction is a row, an unknown gap the default, an empty box kept");
  assert.deepEqual(flatItems(deep.steps[0].items).map((i) => (i.kind === "flex" ? i.dir : i.kind)), ["row", "col", "row", "col", "row"], "the fourth box (and its field) is too deep");
  assert.equal(formFields(deep).length, 0);

  const { createForm, submitForm } = await import("@/plugins/workspace/forms");
  const id = createForm({
    dbId: db,
    def: normalizeForm({
      dbId: db,
      steps: [{ id: "s1", items: [{ id: "t", kind: "field", prop: "title" }, box("row", [box("col", [{ id: "a", kind: "field", prop: "art", required: true }, { id: "m", kind: "field", prop: "menge" }]), box("col", [{ id: "s", kind: "field", prop: "schritte", required: true, when: { prop: "art", op: "eq", value: "o2" } }])])] }],
    }),
  });
  assert.deepEqual(Object.keys(submitForm(id, { title: "x" }).errors), ["a"], "a required field in a column of a row; the hidden one isn't required");
  assert.deepEqual(Object.keys(submitForm(id, { title: "x", art: "o2" }).errors), ["s"], "shown by its condition: required");
  const made = submitForm(id, { title: "x", art: "o1", menge: "4", schritte: "verborgen" });
  const row2 = w.rawRows(db).find((r) => r.id === made.id)!;
  assert.deepEqual([row2.cells.art, row2.cells.menge, row2.cells.schritte], ["o1", 4, undefined], "nested fields collected, the hidden one not");
});

test("the designer's tree: into a box, out of it, no box into itself or too deep, a box removed keeps its parts", async () => {
  const { normalizeForm } = await import("@/plugins/workspace/form-spec");
  const tr = await import("@/plugins/workspace/form-tree");
  let n = 0;
  const id = () => `n${++n}`;
  let def = normalizeForm({ steps: [{ id: "s", items: [{ id: "f", kind: "field", prop: "menge" }] }] });
  const row = tr.newBox("row", id);
  def = tr.placePart(def, row, "s", 1);
  const col = (row.items[0] as { id: string }).id;
  def = tr.placePart(def, tr.findPart(def, "f")!, col, 0);
  assert.deepEqual(tr.spotOf(def, "f"), { owner: col, index: 0, step: 0 });
  assert.equal(tr.canPlace(def, tr.findPart(def, row.id)!, col), false, "not into itself");
  assert.equal(tr.canPlace(def, tr.newBox("row", id), col), false, "a row of columns in a column of a row: four deep, too deep");
  const inner = tr.newBox("col", id);
  def = tr.placePart(def, inner, col, 1);
  assert.equal(tr.partsOf(def, col)!.length, 2, "a column in it: three deep, fine");
  assert.equal(tr.canPlace(def, tr.newBox("col", id), inner.id), false, "a fourth box is too deep");
  def = tr.removePart(def, col, true);
  assert.equal(tr.spotOf(def, "f")!.owner, row.id, "its parts take its place");
  def = tr.placePart(def, tr.findPart(def, "f")!, "s", 0);
  assert.deepEqual(tr.spotOf(def, "f"), { owner: "s", index: 0, step: 0 });
});
