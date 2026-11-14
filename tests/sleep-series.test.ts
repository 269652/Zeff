import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * Sleep as daily series: a sleep tracker's calendar (Sleep as Android) read per day woken on — hours slept (naps too), the main
 * sleep's bedtime (after midnight: 24 +) and waking; a tracking error (over 16 h) or noise (under 15 min) left out. Personal data,
 * and not counted as meeting hours.
 */

test("the values per day woken on: hours in all, the main sleep's bedtime and waking", async () => {
  const { sleepSeriesValues } = await import("@/plugins/calendar/sleep-series");
  const v = sleepSeriesValues(
    [
      { start: "2026-09-20T23:08", end: "2026-09-21T07:32" }, // 8.4 h, before midnight
      { start: "2026-09-21T14:00", end: "2026-09-21T14:30" }, // a nap the same day
      { start: "2026-09-23T00:44", end: "2026-09-23T04:44" }, // after midnight
      { start: "2026-09-16T23:08", end: "2026-09-17T17:56" }, // 18.8 h: a tracking error
      { start: "2026-09-18T03:00", end: "2026-09-18T03:05" }, // noise
      { start: "2026-08-01T23:00", end: "2026-08-02T07:00" }, // outside the range
    ],
    { from: "2026-09-01", to: "2026-09-30" },
  );
  assert.deepEqual([...v.hours], [["2026-09-21", 8.9], ["2026-09-23", 4]]);
  assert.deepEqual([...v.bedtime], [["2026-09-21", 23.13], ["2026-09-23", 24.73]], "after midnight: past 24");
  assert.deepEqual([...v.wake], [["2026-09-21", 7.53], ["2026-09-23", 4.73]]);
});

test("from a sleep tracker's calendar: the series are there, personal, and the nights aren't meeting hours", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "correlations", "calendar"]) setInstalled(id, true);
  await import("@/plugins/contributions");
  const { ensureCalendar, replaceEvents } = await import("@/lib/calendar/ir");
  const sleep = ensureCalendar("google:sleep@group.calendar.google.com", { source: "google", name: "Sleep as Android", busy: true });
  replaceEvents(sleep.id, [{ key: "s1", title: "Schlaf", start: "2026-10-01T23:00", end: "2026-10-02T07:00" }], { from: "2026-09-30", to: "2026-10-05" });
  const { allSeries } = await import("@/lib/series/series");
  const all = await allSeries({ from: "2026-10-01", to: "2026-10-03" });
  const hours = all.find((s) => s.id === "sleep:hours");
  assert.deepEqual([...(hours?.values ?? [])], [["2026-10-02", 8]]);
  const meetings = all.find((s) => s.id === "calendar:meeting-hours");
  // (Other appointments of the test data may be there; the night — 1 h on the 1st, 7 h on the 2nd — isn't.)
  assert.ok((meetings?.values.get("2026-10-02") ?? 0) < 7, `a night's sleep is no meeting: ${JSON.stringify([...(meetings?.values ?? [])])}`);

  const { visibleSeries } = await import("@/lib/series/boundaries");
  assert.ok(visibleSeries(all, "personal").some((s) => s.id === "sleep:hours"));
  assert.ok(!visibleSeries(all, "open").some((s) => s.id.startsWith("sleep:")), "an agent without personal clearance doesn't see sleep");
});
