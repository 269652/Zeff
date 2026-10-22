import assert from "node:assert/strict";
import test from "node:test";
import { hideRows, newView, normalizeSchema, shownRows, type DbSchema, type Row } from "../src/plugins/workspace/model";

const schema = (): DbSchema => ({ titleName: "Name", properties: [], views: [newView("Table")] });
const row = (id: number): Row => ({ id, title: `R${id}`, cells: {} }) as Row;

test("rows hidden in a database: kept by id (no twice), shown again, none left — no key", () => {
  let s = hideRows(schema(), [1, 2], true);
  assert.deepEqual(s.hiddenRows, [1, 2]);
  s = hideRows(s, [2, 3], true);
  assert.deepEqual(s.hiddenRows, [1, 2, 3]);
  s = hideRows(s, [1, 3], false);
  assert.deepEqual(s.hiddenRows, [2]);
  s = hideRows(s, [2], false);
  assert.equal("hiddenRows" in s, false);
});

test("the hidden rows survive a save (row ids only, each once); a view's switch to show them too", () => {
  const raw = { ...schema(), hiddenRows: [4, "x", 4, 7, -1], views: [{ ...newView("Table"), showHidden: true }] };
  const s = normalizeSchema(raw);
  assert.deepEqual(s.hiddenRows, [4, 7]);
  assert.equal(s.views[0].showHidden, true);
});

test("a view shows the rows not hidden — all of them when it shows the hidden ones too", () => {
  const s = hideRows(schema(), [2], true);
  const rows = [row(1), row(2), row(3)];
  assert.deepEqual(shownRows(rows, s, s.views[0]).map((r) => r.id), [1, 3]);
  assert.deepEqual(shownRows(rows, s, { ...s.views[0], showHidden: true }).map((r) => r.id), [1, 2, 3]);
});
