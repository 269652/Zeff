import assert from "node:assert/strict";
import test from "node:test";
import { layoutDag } from "../src/lib/graph/layout";

const pos = (nodes: { key: string; after: string[] }[]) => layoutDag(nodes).pos;

test("a chain: one column after the other, one row", () => {
  const p = pos([{ key: "a", after: [] }, { key: "b", after: ["a"] }, { key: "c", after: ["b"] }]);
  assert.deepEqual([...p.values()].map((x) => x.col), [0, 1, 2]);
  assert.deepEqual([...p.values()].map((x) => x.row), [0, 0, 0]);
});

test("a diamond: the two in the middle share a column, in rows of their own", () => {
  const l = layoutDag([{ key: "a", after: [] }, { key: "b", after: ["a"] }, { key: "c", after: ["a"] }, { key: "d", after: ["b", "c"] }]);
  assert.equal(l.pos.get("b")!.col, 1);
  assert.equal(l.pos.get("c")!.col, 1);
  assert.notEqual(l.pos.get("b")!.row, l.pos.get("c")!.row);
  assert.equal(l.pos.get("d")!.col, 2);
  assert.equal(l.cols, 3);
  assert.equal(l.rows, 2);
});

test("a node's column comes after its longest way in", () => {
  const p = pos([{ key: "a", after: [] }, { key: "b", after: ["a"] }, { key: "c", after: ["b"] }, { key: "d", after: ["a", "c"] }]);
  assert.equal(p.get("d")!.col, 3);
});

test("rows follow their predecessors, so lines don't cross needlessly", () => {
  // x1 → y2 and x2 → y1, listed crosswise: the second column is reordered to follow the first.
  const p = pos([{ key: "x1", after: [] }, { key: "x2", after: [] }, { key: "y1", after: ["x2"] }, { key: "y2", after: ["x1"] }]);
  assert.ok(p.get("y2")!.row < p.get("y1")!.row);
});

test("unknown predecessors are ignored, a cycle doesn't hang", () => {
  const p = pos([{ key: "a", after: ["zz", "b"] }, { key: "b", after: ["a"] }]);
  assert.equal(p.size, 2);
});
