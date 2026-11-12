import assert from "node:assert/strict";
import test from "node:test";
import { currentDir, nextDir, sortOrder } from "../src/plugins/workspace/table-sort";

test("numbers sort by value, before text; empty cells stay last", () => {
  const col = ["10", "", "2", "Zebra", "1.200,50 €", "apfel"];
  assert.deepEqual(sortOrder(col, "asc").map((i) => col[i]), ["2", "10", "1.200,50 €", "apfel", "Zebra", ""]);
  assert.deepEqual(sortOrder(col, "desc").map((i) => col[i]), ["Zebra", "apfel", "1.200,50 €", "10", "2", ""]);
});

test("a click sorts ascending first, then descending", () => {
  const col = ["b", "c", "a"];
  assert.equal(currentDir(col), null);
  assert.equal(nextDir(col), "asc");
  const asc = sortOrder(col, "asc").map((i) => col[i]);
  assert.deepEqual(asc, ["a", "b", "c"]);
  assert.equal(currentDir(asc), "asc");
  assert.equal(nextDir(asc), "desc");
  assert.equal(currentDir(["c", "b", "a"]), "desc");
});

test("sorting is stable and digits inside text read as numbers", () => {
  const col = ["x10", "x9", "x10"];
  assert.deepEqual(sortOrder(col, "asc"), [1, 0, 2]);
  assert.equal(currentDir(["same", "same"]), null);
});
