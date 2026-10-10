import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { setupTempData } from "./helpers";

process.env.ZEFF_CALENDAR_INBOX = path.join(setupTempData(), "calendar-inbox.json");
process.env.GCAL_NO_SERVER = "1";

const titles = (list: { title: string; start: string }[]) => list.map((e) => `${e.start} ${e.title}`);

/** A series in Zeff's own calendar: expanded when read (and in the busy times), one / following / all changed and deleted. */
test("calendar series: read, busy times, change one / following / all, delete", async () => {
  const ir = await import("@/lib/calendar/ir");
  const cal = ir.createCalendar("Serien");
  // Weekly on Monday 09:00–10:00, from 12 Oct 2026, 6 times.
  const s = ir.addEvent(cal.id, { title: "Standup", start: "2026-10-12T09:00", end: "2026-10-12T10:00", recurrence: { freq: "weekly", interval: 1, byDay: [0], count: 6 } });
  assert.deepEqual(titles(ir.eventsBetween("2026-10-12", "2026-11-03")), ["2026-10-12T09:00 Standup", "2026-10-19T09:00 Standup", "2026-10-26T09:00 Standup", "2026-11-02T09:00 Standup"]);
  // The busy times (what appointment proposals avoid) know them too.
  assert.equal(ir.busyBetween(new Date("2026-10-19T00:00:00"), new Date("2026-10-20T00:00:00")).length, 1);

  // One occurrence moved to 11:00: left out of the series, an appointment of its own.
  const moved = ir.updateOccurrence(s.id, "2026-10-19", { start: "2026-10-19T11:00", end: "2026-10-19T12:00" }, "one");
  assert.equal(moved.seriesId, s.id);
  assert.deepEqual(titles(ir.eventsBetween("2026-10-19", "2026-10-20")), ["2026-10-19T11:00 Standup"]);

  // From 26 Oct on, renamed: the series ends before it, a new one (the rest of the count) begins.
  ir.updateOccurrence(s.id, "2026-10-26", { title: "Daily sync" }, "following");
  assert.deepEqual(titles(ir.eventsBetween("2026-10-12", "2026-12-31")), [
    "2026-10-12T09:00 Standup",
    "2026-10-19T11:00 Standup",
    "2026-10-26T09:00 Daily sync",
    "2026-11-02T09:00 Daily sync",
    "2026-11-09T09:00 Daily sync",
    "2026-11-16T09:00 Daily sync",
  ]);

  // The new series moved as a whole to Tuesday 08:30: every occurrence (and its weekday) moves.
  const second = ir.eventsBetween("2026-10-26", "2026-10-27")[0];
  ir.updateOccurrence(second.id, "2026-10-26", { start: "2026-10-27T08:30", end: "2026-10-27T09:30" }, "all");
  assert.deepEqual(titles(ir.eventsBetween("2026-10-26", "2026-11-12")), ["2026-10-27T08:30 Daily sync", "2026-11-03T08:30 Daily sync", "2026-11-10T08:30 Daily sync"]);

  // Deleted: one occurrence, then the rest from one on, then a whole series (with its changed occurrence).
  ir.deleteOccurrence(second.id, "2026-11-03", "one");
  ir.deleteOccurrence(second.id, "2026-11-10", "following");
  assert.deepEqual(titles(ir.eventsBetween("2026-10-26", "2026-12-31")), ["2026-10-27T08:30 Daily sync"]);
  ir.deleteOccurrence(s.id, "2026-10-12", "all");
  assert.deepEqual(titles(ir.eventsBetween("2026-10-01", "2026-10-26")), []);
});
