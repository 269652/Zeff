import assert from "node:assert/strict";
import test from "node:test";
import { endOf, layoutItems, normalizeStart, workMinutesBetween } from "../src/lib/entry-timeline";

const lunch = [{ start: "12:00", end: "12:30" }];
const m = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const hhmm = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;

test("an end is the start plus the hours, with the breaks left out", () => {
  assert.equal(hhmm(endOf(m("09:00"), 120, lunch)), "11:00");
  // 11:00 + 2 h runs through the lunch break: 1 h before it, 1 h after it, +30 min break.
  assert.equal(hhmm(endOf(m("11:00"), 120, lunch)), "13:30");
  // Starting inside the break: it begins when the break is over.
  assert.equal(hhmm(endOf(m("12:10"), 60, lunch)), "13:30");
  assert.equal(hhmm(endOf(m("14:00"), 60, [])), "15:00");
  assert.equal(workMinutesBetween(m("11:00"), m("13:30"), lunch), 120);
});

test("overlapping items: sequential adds up, parallel takes the span", () => {
  const items = (parallel: boolean) => [
    { id: 1, start: "09:00", hours: 3, parallel: false },
    { id: 2, start: "10:00", hours: 3, parallel },
  ];
  // Sequential: 3 h + 3 h, the second counted from the end of the first (12:00 → lunch → 15:30).
  const seq = layoutItems(items(false), lunch);
  assert.equal(seq.itemizedHours, 6);
  assert.equal(seq.items[1].overlapsPrevious, true);
  assert.equal(seq.items[1].shiftedStart, "12:00");
  assert.equal(seq.items[1].end, "15:30");
  // Parallel: from 09:00 to the later end (10:00 + 3 h through lunch = 13:30), minus the break: 4.5 h − 0.5 h = 4 h.
  const par = layoutItems(items(true), lunch);
  assert.equal(par.items[1].end, "13:30");
  assert.equal(par.itemizedHours, 4);
  assert.deepEqual(par.blocks.map((b) => [b.from, b.to, b.workHours]), [["09:00", "13:30", 4]]);
});

test("items that do not overlap are separate stretches; items without a start add up", () => {
  const l = layoutItems(
    [
      { id: 1, start: "09:00", hours: 1, parallel: false },
      { id: 2, start: "10:00", hours: 1, parallel: true }, // touching, not overlapping
      { id: 3, start: null, hours: 0.5, parallel: false },
    ],
    [],
  );
  assert.equal(l.blocks.length, 2);
  assert.equal(l.items[1].overlapsPrevious, false);
  assert.deepEqual(l.unplaced, [3]);
  assert.equal(l.itemizedHours, 2.5);
  assert.equal(l.items[2].end, null);
});

test("a time of the day is understood the way it is typed", () => {
  assert.equal(normalizeStart("9"), "09:00");
  assert.equal(normalizeStart("9.30"), "09:30");
  assert.equal(normalizeStart("1430"), "14:30");
  assert.equal(normalizeStart("25:00"), null);
  assert.equal(normalizeStart(""), null);
});

import { combineDescription, divideHours, parallelClusters, sequentialStarts } from "../src/lib/entry-timeline";

test("parallel work: overlapping entries of one key form a cluster with the span's hours", () => {
  const e = (id: number, start: string | null, hours: number, key = "job") => ({ id, start, hours, key });
  // 10:00–13:00 twice (3 h each): one stretch of 3 h worth of work, booked as 6 h.
  const [c] = parallelClusters([e(1, "10:00", 3), e(2, "10:00", 3), e(3, "15:00", 1), e(4, null, 2), e(5, "10:30", 1, "other")], []);
  assert.deepEqual({ ids: c.ids, from: c.from, to: c.to, span: c.spanHours, sum: c.sumHours }, { ids: [1, 2], from: "10:00", to: "13:00", span: 3, sum: 6 });
  assert.equal(parallelClusters([e(1, "10:00", 3), e(2, "10:00", 3), e(3, "15:00", 1), e(4, null, 2), e(5, "10:30", 1, "other")], []).length, 1);
  // Chained overlaps are one cluster; a break inside is not worked.
  const chain = parallelClusters([e(1, "11:00", 2), e(2, "12:30", 2)], lunch);
  assert.equal(chain.length, 1);
  assert.equal(chain[0].to, "14:30"); // the second one works from 12:30 (lunch is over) for 2 h
  assert.equal(chain[0].spanHours, 3); // 11:00–14:30 = 3.5 h − 30 min lunch
});

test("hours divided over parallel entries add up to the span", () => {
  const d = divideHours(3, [{ id: 1, hours: 3 }, { id: 2, hours: 3 }]);
  assert.deepEqual([d.get(1), d.get(2)], [1.5, 1.5]);
  const odd = divideHours(2, [{ id: 1, hours: 1 }, { id: 2, hours: 1 }, { id: 3, hours: 1 }]);
  assert.equal(Math.round([...odd.values()].reduce((s, v) => s + v, 0) * 100) / 100, 2);
  const weighted = divideHours(4, [{ id: 1, hours: 1 }, { id: 2, hours: 3 }]);
  assert.deepEqual([weighted.get(1), weighted.get(2)], [1, 3]);
});

test("sequential: each parallel entry starts where the one before ends", () => {
  const moved = sequentialStarts([{ id: 1, start: "10:00", hours: 2 }, { id: 2, start: "10:30", hours: 1 }, { id: 3, start: "10:45", hours: 1 }], []);
  assert.deepEqual([...moved], [[2, "12:00"], [3, "13:00"]]);
  // A break in between: the second begins after the first ends, which is after the lunch.
  const withLunch = sequentialStarts([{ id: 1, start: "11:00", hours: 2 }, { id: 2, start: "11:30", hours: 1 }], lunch);
  assert.deepEqual([...withLunch], [[2, "13:30"]]);
});

test("a combined entry names the tickets and what was done", () => {
  assert.equal(combineDescription([{ ticket: "proj-1", description: "Login" }, { ticket: "PROJ-2", description: "Header" }]), "PROJ-1, PROJ-2: Login · Header");
  assert.equal(combineDescription([{ ticket: null, description: "A" }, { ticket: null, description: "A" }]), "A");
});
