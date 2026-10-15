import assert from "node:assert/strict";
import test from "node:test";
import { dayFrame, dayProgress, freeWindows, pct, phaseOf, workSpan } from "../src/lib/heute-day";

const at = (h: number, m = 0) => new Date(2026, 9, 14, h, m).getTime();
const iso = (h: number, m = 0) => new Date(at(h, m)).toISOString();
const meet = (a: [number, number?], b: [number, number?]) => ({ subject: "x", start: iso(...a), end: iso(...b), online: false });

test("free windows: from now on, around the meetings, long enough to work in", () => {
  const work = workSpan(at(10));
  const w = freeWindows([meet([11], [12]), meet([11, 30], [12, 30]), meet([15], [15, 20])], at(10), work);
  // 10:00–11:00 free, 12:30–15:00 free, 15:20–18:00 free (overlapping meetings count once).
  assert.deepEqual(w.map((x) => [new Date(x.from).getHours() * 60 + new Date(x.from).getMinutes(), new Date(x.to).getHours() * 60 + new Date(x.to).getMinutes()]), [[600, 660], [750, 900], [920, 1080]]);
});

test("a free stretch shorter than the minimum is not offered, a meeting now moves the start", () => {
  const work = workSpan(at(9));
  assert.deepEqual(freeWindows([meet([9], [17, 30])], at(9, 30), work), []); // 30 min left only
  const w = freeWindows([meet([9], [10])], at(9, 30), work);
  assert.equal(w[0].from, at(10));
});

test("the frame widens for a meeting outside 7–19", () => {
  const f = dayFrame(at(10), [meet([6, 30], [7, 30]), meet([19, 15], [20])]);
  assert.equal(f.from, at(6));
  assert.equal(f.to, at(21));
  assert.equal(pct(at(10), { from: at(8), to: at(12) }), 50);
});

test("day progress and phase", () => {
  const work = workSpan(at(12));
  assert.equal(dayProgress(at(8), work), 0);
  assert.equal(dayProgress(at(13), work), 0.5);
  assert.equal(dayProgress(at(20), work), 1);
  assert.deepEqual([3, 9, 13, 19].map((h) => phaseOf(at(h))), ["night", "morning", "day", "evening"]);
});
