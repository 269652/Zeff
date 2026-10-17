import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** Forms, conditions and tabs for building an app's pages: a form block makes a row (a routine on "row added" can take it from there). */
async function world() {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "work", "todos"]) setInstalled(id, true);
  const w = await import("@/plugins/workspace/store");
  const db = w.createPage({ kind: "database", title: "Anfragen" });
  w.updateSchema(db, {
    ...w.getDatabase(db)!.schema,
    titleName: "Betreff",
    properties: [
      { id: "kunde", name: "Kunde", type: "text" },
      { id: "prio", name: "Priorität", type: "select", options: [{ id: "o1", name: "Normal", color: "gray" }, { id: "o2", name: "Hoch", color: "red" }] },
      { id: "menge", name: "Menge", type: "number" },
      { id: "eilig", name: "Eilig", type: "checkbox" },
      { id: "intern", name: "Intern", type: "text" },
    ],
  });
  return { w, db };
}

test("submitForm: a row from what was typed — only the fields the form has, a choice only from its options, a title needed", async () => {
  const { w, db } = await world();
  const { submitForm } = await import("@/plugins/workspace/app-blocks");
  const id = submitForm(db, ["kunde", "prio", "menge", "eilig"], { title: "Neue Anfrage", kunde: "Anna", prio: "Hoch", menge: "3", eilig: "true", intern: "darf nicht rein" });
  const row = w.rawRows(db).find((r) => r.id === id)!;
  assert.equal(row.title, "Neue Anfrage");
  assert.equal(row.cells.kunde, "Anna");
  assert.equal(row.cells.prio, "o2", "the option by its name");
  assert.equal(row.cells.menge, 3);
  assert.equal(row.cells.eilig, true);
  assert.equal(row.cells.intern, undefined, "a field the form does not have is not set");
  assert.throws(() => submitForm(db, ["kunde"], { title: "  ", kunde: "x" }), /title|Betreff/i);
  assert.throws(() => submitForm(db, ["prio"], { title: "x", prio: "Dringlichst" }), /choice|option|Dringlichst/i);
  assert.throws(() => submitForm(424242, [], { title: "x" }), /database/i);
  const again = submitForm(db, ["kunde"], { title: "Ohne Rest", kunde: "" });
  assert.equal(w.rawRows(db).find((r) => r.id === again)!.cells.kunde, undefined, "an empty field is no value");
});

test("a form's row starts the routines that listen to new rows", async () => {
  const { w, db } = await world();
  const r = await import("@/plugins/workspace/routines");
  const { submitForm } = await import("@/plugins/workspace/app-blocks");
  const page = w.createPage({ title: "Anfrage-Eingang" });
  r.createRoutine(page, "automation", { enabled: true, triggers: [{ kind: "event", event: "row.added", db }], steps: [{ id: "n", kind: "notify", text: "Neu: {{row.title}}" }] });
  submitForm(db, [], { title: "Per Formular" });
  const t0 = Date.now();
  while (!r.routineRuns(page).length && Date.now() - t0 < 3000) await new Promise((res) => setTimeout(res, 30));
  assert.equal(r.routineRuns(page)[0]?.log[0]?.note, "Neu: Per Formular");
});

test("the blocks in a page: form, condition and tabs — their attributes kept to what they can be", async () => {
  const { sanitizeDoc } = await import("@/plugins/workspace/doc");
  const p = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
  const doc = sanitizeDoc({
    type: "doc",
    content: [
      { type: "zeffForm", attrs: { dbId: "5", fields: '["kunde","prio",3]', label: "Senden", evil: 1 } },
      { type: "zeffForm", attrs: { dbId: "x", fields: "[]" } },
      { type: "zeffIf", attrs: { field: "Status", op: "is", value: "Offen", evil: 1 }, content: [p("nur wenn offen")] },
      { type: "zeffIf", attrs: { field: "", op: "is", value: "" }, content: [p("ohne Feld: bleibt, immer sichtbar")] },
      { type: "zeffIf", attrs: { field: "Status", op: "teleport", value: "x" }, content: [p("unbekannte Bedingung")] },
      { type: "zeffTabs", attrs: { titles: '["Eins","Zwei"]', active: 1 }, content: [{ type: "flexBox", attrs: { dir: "col" }, content: [p("A")] }, { type: "flexBox", attrs: { dir: "col" }, content: [p("B")] }] },
    ],
  }) as { content: { type: string; attrs?: Record<string, unknown>; content?: unknown[] }[] };
  assert.deepEqual(doc.content.map((n) => n.type), ["zeffForm", "zeffIf", "zeffIf", "zeffIf", "zeffTabs"], "a form needs its database");
  assert.deepEqual(doc.content[0].attrs, { dbId: 5, fields: '["kunde","prio"]', label: "Senden" }, "fields are texts");
  assert.deepEqual(doc.content[1].attrs, { field: "Status", op: "is", value: "Offen" });
  assert.equal(doc.content[3].attrs!.op, "is", "an unknown condition is the default one");
  assert.equal(doc.content[4].attrs!.titles, '["Eins","Zwei"]');
  assert.equal(doc.content[4].attrs!.active, 1);
  assert.equal(doc.content[4].content!.length, 2);
});
