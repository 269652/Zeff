import assert from "node:assert/strict";
import test from "node:test";
import { coerceCellValue, newProperty, withCell, TITLE, type Row } from "@/plugins/workspace/model";

const dose = { ...newProperty("Dosis (mg)", "number"), id: "dose" };
const when = { ...newProperty("Genommen um", "date"), id: "when" };
const note = { ...newProperty("Notiz", "text"), id: "note" };
const row = (id: number, cells: Record<string, unknown> = {}): Row => ({ id, title: `Row ${id}`, cells }) as unknown as Row;

test("a cell's value as the server stores it — typed text becomes a number, what can't be is dropped", () => {
  assert.equal(coerceCellValue(dose, "12,5"), 12.5);
  assert.equal(coerceCellValue(dose, "75"), 75);
  assert.equal(coerceCellValue(dose, ""), null);
  assert.equal(coerceCellValue(dose, "viel"), null);
  assert.equal(coerceCellValue(when, "2026-10-25T08:30"), "2026-10-25T08:30");
  assert.equal(coerceCellValue(when, "gestern"), null);
  assert.equal(coerceCellValue(note, ""), null);
});

test("a row dropped in a table: the rows it lands between — dropped on itself, nowhere", async () => {
  const { dropBetween } = await import("@/plugins/workspace/model");
  const ids = [1, 2, 3, 4];
  assert.deepEqual(dropBetween(ids, 4, 2, false), { after: 1, before: 2 }, "above row 2");
  assert.deepEqual(dropBetween(ids, 1, 3, true), { after: 3, before: 4 }, "below row 3");
  assert.deepEqual(dropBetween(ids, 2, 4, true), { after: 4, before: null }, "the end");
  assert.deepEqual(dropBetween(ids, 3, 1, false), { after: null, before: 1 }, "the start");
  assert.deepEqual(dropBetween(ids, 2, 3, false), null, "where it is already (above the next one)");
  assert.equal(dropBetween(ids, 2, 2, true), null, "on itself");
});

test("an edit shown at once: the row gets the value as it will be stored, the other rows stay as they are", () => {
  const rows = [row(1, { dose: 50 }), row(2, { dose: 25 })];
  const next = withCell(rows, [dose, when, note], 1, "dose", "75");
  assert.equal(next[0].cells.dose, 75);
  assert.equal(next[1], rows[1]);
  assert.equal(withCell(rows, [dose], 1, "dose", "")[0].cells.dose, undefined);
  assert.equal(withCell(rows, [dose], 2, TITLE, "Venlafaxin")[1].title, "Venlafaxin");
});
