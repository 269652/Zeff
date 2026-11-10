import assert from "node:assert/strict";
import test from "node:test";
import { centre, labelPoint, laneY, roundedPath, threadCorners, type Grid, type Pt } from "../src/components/skill-tree/thread-route";

const g: Grid = { col: 190, row: 118, top: 40, r: 28, width: 190 * 5, height: 40 + 118 * 2 };
const cells = (...cs: [number, number][]) => {
  const s = new Set(cs.map(([c, r]) => `${c}:${r}`));
  return (c: number, r: number) => s.has(`${c}:${r}`);
};

/** Whether a stretch of the way crosses a node's box (its circle and title: the cell's middle, a circle wide, down to the title's end). */
function crossesNode(pts: Pt[], taken: [number, number][]): boolean {
  for (const [c, r] of taken) {
    const m = centre(g, { col: c, row: r });
    const box = { x1: m.x - g.col / 2 + 9, x2: m.x + g.col / 2 - 9, y1: m.y - g.r - 2, y2: m.y + g.r + 36 };
    for (let i = 1; i < pts.length; i++) {
      const [a, b] = [pts[i - 1], pts[i]];
      for (let t = 0; t <= 1; t += 0.02) {
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        const inCircleRow = Math.abs(y - m.y) < g.r + 2 && Math.abs(x - m.x) < g.r - 1;
        const inTitle = y > m.y + g.r + 2 && y < box.y2 && x > box.x1 && x < box.x2;
        if (inCircleRow || inTitle) return true;
      }
    }
  }
  return false;
}

test("next to each other on a row: straight across", () => {
  const pts = threadCorners(g, { col: 0, row: 0 }, { col: 1, row: 0 }, cells([0, 0], [1, 0]));
  assert.equal(pts.length, 2);
  assert.equal(pts[0].y, pts[1].y);
});

test("one above the other: out to the side, down the gap, back in — not through the title", () => {
  const taken: [number, number][] = [[0, 0], [0, 1]];
  const pts = threadCorners(g, { col: 0, row: 0 }, { col: 0, row: 1 }, cells(...taken));
  assert.equal(pts[1].x, g.col); // the gap after the column
  assert.ok(!crossesNode(pts.slice(1, -1), taken));
});

test("diagonally: along the free row, then up or down the gap before the target", () => {
  const taken: [number, number][] = [[0, 1], [1, 0], [2, 0]];
  const pts = threadCorners(g, { col: 0, row: 1 }, { col: 2, row: 0 }, cells(...taken));
  // Row 0 has a node in column 1 between: the way runs along row 1 (free), then up the gap before column 2.
  assert.equal(pts[1].x, 2 * g.col);
  assert.equal(pts[1].y, centre(g, { col: 0, row: 1 }).y);
  assert.ok(!crossesNode(pts, [[1, 0]]));
});

test("nodes on both rows in between: over the strip between the rows", () => {
  const taken: [number, number][] = [[0, 0], [1, 0], [1, 1], [2, 1]];
  const pts = threadCorners(g, { col: 0, row: 0 }, { col: 2, row: 1 }, cells(...taken));
  assert.equal(pts.length, 6);
  assert.equal(pts[2].y, laneY(g, 1));
  assert.ok(!crossesNode(pts, [[1, 0], [1, 1]]));
  for (const p of pts) assert.ok(p.y > 0 && p.y < g.height);
});

test("the same row with a node between: around it on a strip inside the map", () => {
  const taken: [number, number][] = [[0, 1], [1, 1], [2, 1]];
  const pts = threadCorners(g, { col: 0, row: 1 }, { col: 2, row: 1 }, cells(...taken));
  assert.ok(!crossesNode(pts, [[1, 1]]));
  for (const p of pts) assert.ok(p.y > 0 && p.y < g.height);
});

test("a rounded path; a number kept clear of those placed already", () => {
  const corners = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
  assert.match(roundedPath(corners), /^M0,0 L88,0 Q100,0 100,12 L100,100$/);
  const first = labelPoint(corners, []);
  const second = labelPoint(corners, [first]);
  assert.ok(Math.hypot(first.x - second.x, first.y - second.y) >= 22);
});
