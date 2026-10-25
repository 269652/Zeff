import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

// A field filled by itself: when a field it watches changes in a row, its formula is worked out and the result goes in — in the field's
// own type (a date with the time, a number), still to be set by hand. "Record the time when ticked" on a checkbox is one made for you.

async function routine(extra: object[] = []) {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("workspace", true);
  const w = await import("@/plugins/workspace/store");
  const db = w.createPage({
    kind: "database",
    title: "Routine",
    schema: {
      titleName: "Name",
      properties: [{ id: "done", name: "Erledigt", type: "checkbox" }, { id: "note", name: "Notiz", type: "text" }, ...(extra as never[])],
      views: [{ id: "v1", name: "Table", type: "table", filter: { op: "and", rules: [] }, sorts: [], hidden: [] }],
    },
  });
  const r = w.addRow(db, { title: "Aufstehen" });
  return { w, db, r };
}

const when = { id: "at", name: "Wann", type: "date", includeTime: true, auto: { on: ["done"], formula: 'if(prop("Erledigt"), now(), "")' } };

test("ticked: the time now goes in (a date with the time); unticked: it goes; another field changed: left alone; set by hand: kept", async () => {
  const { w, r } = await routine([when]);
  w.setCell(r, "done", true);
  const at = w.getPage(r)!.props.at;
  assert.match(String(at), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  w.setCell(r, "at", "2026-10-24T07:15");
  w.setCell(r, "note", "früh");
  assert.equal(w.getPage(r)!.props.at, "2026-10-24T07:15", "not watched: left alone, the hand's time kept");
  w.setCell(r, "done", false);
  assert.equal(w.getPage(r)!.props.at, undefined);
});

test("any type, any formula: a number from two fields, worked out again when either changes", async () => {
  const { w, r } = await routine([
    { id: "a", name: "A", type: "number" },
    { id: "b", name: "B", type: "number" },
    { id: "p", name: "Produkt", type: "number", auto: { on: ["a", "b"], formula: 'prop("A") * prop("B")' } },
  ]);
  w.setCell(r, "a", 3);
  w.setCell(r, "b", 4);
  assert.equal(w.getPage(r)!.props.p, 12);
  w.setCell(r, "a", 5);
  assert.equal(w.getPage(r)!.props.p, 20);
});

test("two fields filling each other: no endless loop", async () => {
  const { w, r } = await routine([
    { id: "x", name: "X", type: "number", auto: { on: ["y"], formula: 'prop("Y") + 1' } },
    { id: "y", name: "Y", type: "number", auto: { on: ["x"], formula: 'prop("X") + 1' } },
  ]);
  w.setCell(r, "x", 1);
  assert.equal(typeof w.getPage(r)!.props.y, "number");
});

test('"Record the time when ticked" saved: the field filled by itself is made at once — its formula to be seen and changed', async () => {
  const { w, db } = await routine();
  const s = w.getDatabase(db)!.schema;
  w.updateSchema(db, { ...s, properties: s.properties.map((p) => (p.id === "done" ? { ...p, stampTime: true } : p)) });
  const made = w.getDatabase(db)!.schema.properties.find((p) => p.stampOf === "done")!;
  assert.equal(made.type, "date");
  assert.equal(made.includeTime, true);
  assert.deepEqual(made.auto, { on: ["done"], formula: 'if(prop("Erledigt"), now(), "")' });
  assert.equal(w.getDatabase(db)!.schema.properties.findIndex((p) => p.id === made.id), 1, "beside the checkbox");
  // Saved again: not a second one.
  w.updateSchema(db, w.getDatabase(db)!.schema);
  assert.equal(w.getDatabase(db)!.schema.properties.filter((p) => p.stampOf === "done").length, 1);
});

test("a time field from before (no formula yet) gets its formula; a field renamed: the formulas naming it follow", async () => {
  const { w, db, r } = await routine([{ id: "old", name: "Erledigt um", type: "date", includeTime: true, stampOf: "done" }]);
  const s = w.getDatabase(db)!.schema;
  w.updateSchema(db, { ...s, properties: s.properties.map((p) => (p.id === "done" ? { ...p, stampTime: true } : p)) });
  assert.equal(w.getDatabase(db)!.schema.properties.find((p) => p.id === "old")!.auto?.formula, 'if(prop("Erledigt"), now(), "")');
  const s2 = w.getDatabase(db)!.schema;
  w.updateSchema(db, { ...s2, properties: s2.properties.map((p) => (p.id === "done" ? { ...p, name: "Gemacht" } : p)) });
  assert.equal(w.getDatabase(db)!.schema.properties.find((p) => p.id === "old")!.auto?.formula, 'if(prop("Gemacht"), now(), "")');
  w.setCell(r, "done", true);
  assert.match(String(w.getPage(r)!.props.old), /T\d{2}:\d{2}$/, "still works after the rename");
});
