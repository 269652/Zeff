import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

// The week to book: each day as proposeDay has it (Monday to today), the tickets you only committed to estimated from the
// commits' span (half an hour before the first to the last, in quarters, at most 6 h).
setupTempData();

test("commits' span as hours: from half an hour before the first to the last, in quarters, capped — none without commits", async () => {
  const { commitSpan } = await import("@/lib/feierabend");
  const local = (h: number, m: number) => new Date(2026, 9, 27, h, m).toISOString();
  assert.deepEqual(commitSpan([local(11, 40), local(9, 12)]), { start: "08:42", end: "11:40", hours: 3 });
  assert.deepEqual(commitSpan([local(10, 0)]), { start: "09:30", end: "10:00", hours: 0.5 });
  assert.equal(commitSpan([local(7, 0), local(20, 0)])?.hours, 6);
  assert.equal(commitSpan([]), null);
});

test("the week: its workdays up to today, each with its date and target — a key it doesn't know is this week", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("zeiterfassung", true);
  const { proposeWeek } = await import("@/lib/feierabend");
  const { currentWeek, isoDate } = await import("@/lib/week");
  const w = await proposeWeek(null);
  assert.equal(w.key, currentWeek().key);
  const today = isoDate(new Date());
  assert.ok(w.days.length >= 0 && w.days.length <= 5);
  assert.ok(w.days.every((d) => d.date <= today));
  assert.deepEqual(w.days.map((d) => d.date), currentWeek().days.slice(0, 5).map(isoDate).filter((d) => d <= today));
  assert.equal((await proposeWeek("nonsense")).key, currentWeek().key);
  // A past week: all five days.
  const { shiftWeek } = await import("@/lib/week");
  assert.equal((await proposeWeek(shiftWeek(currentWeek(), -1).key)).days.length, 5);
});
