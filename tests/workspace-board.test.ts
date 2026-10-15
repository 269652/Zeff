import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * The board view, the logic under the drag & drop: what a card's grouped property becomes when it's
 * dropped into another column, and where it lands among the cards there.
 */

test("dropValue: a single value is replaced; a multi value only swaps the column it came from", async () => {
  const { dropValue, newProperty } = await import("@/plugins/workspace/model");
  const status = newProperty("Status", "status");
  const tags = { ...newProperty("Tags", "multi_select"), options: [{ id: "a", name: "A", color: "red" }, { id: "b", name: "B", color: "blue" }, { id: "c", name: "C", color: "green" }] };
  const who = newProperty("Who", "person");
  const done = newProperty("Done", "checkbox");

  assert.equal(dropValue(status, "x", "x", "y"), "y");
  assert.equal(dropValue(status, "x", "x", ""), null, "into No value: cleared");
  assert.deepEqual(dropValue(tags, ["a", "b"], "a", "c"), ["b", "c"], "the other tags stay");
  assert.deepEqual(dropValue(tags, ["a", "b"], "a", "b"), ["b"], "into a column it has already: no double");
  assert.equal(dropValue(tags, ["a"], "a", ""), null, "the last one out: none left");
  assert.deepEqual(dropValue(tags, ["a", "b"], "a", ""), ["b"]);
  assert.deepEqual(dropValue(tags, null, "", "c"), ["c"], "from No value");
  assert.deepEqual(dropValue(who, [3, 4], "3", "5"), [4, 5], "people: numbers");
  assert.equal(dropValue(done, false, "false", "true"), true);
});

test("placeRow: a card lands between its neighbours — the order holds after many moves", async () => {
  const w = await import("@/plugins/workspace/store");
  const dbId = w.createPage({ kind: "database", title: "Order" });
  const [a, b, c, d] = ["A", "B", "C", "D"].map((title) => w.addRow(dbId, { title }));
  const order = () => w.rawRows(dbId).map((r) => r.title).join("");
  assert.equal(order(), "ABCD");

  w.placeRow(d, { after: a, before: b });
  assert.equal(order(), "ADBC");
  w.placeRow(a, { after: c, before: null });
  assert.equal(order(), "DBCA", "to the end");
  w.placeRow(c, { after: null, before: d });
  assert.equal(order(), "CDBA", "to the top");
  // Always right behind C: the gap halves each time — the order must hold past what a float can split.
  const added: number[] = [];
  for (let i = 0; i < 60; i++) {
    const ids = w.rawRows(dbId).map((r) => r.id);
    const x = w.addRow(dbId, { title: `x${i}` });
    w.placeRow(x, { after: c, before: ids[ids.indexOf(c) + 1] ?? null });
    added.unshift(x);
  }
  const ids = w.rawRows(dbId).map((r) => r.id);
  assert.deepEqual(ids, [c, ...added, d, b, a], "each new one right behind C, the newest first");
  const other = w.createPage({ kind: "database", title: "Other" });
  assert.throws(() => w.placeRow(a, { after: w.addRow(other, { title: "O" }), before: null }), /not a row of the same database/);
});
