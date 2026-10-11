import assert from "node:assert/strict";
import test from "node:test";
import { describeRecurrence, expand, occurrenceDays, parseRecurrence } from "@/lib/calendar/recurrence";

/** Recurring appointments: the days a rule makes, its ends, what's left out, the edges of months and years. */
test("recurrence: daily, weekly on weekdays, every 2 weeks", () => {
  assert.deepEqual(occurrenceDays("2026-10-12T09:00", { freq: "daily", interval: 1, count: 3 }, "2027-01-01"), ["2026-10-12", "2026-10-13", "2026-10-14"]);
  // Weekdays from a Wednesday: Wed, Thu, Fri, then Mon … (not the Mon/Tue before the first one).
  assert.deepEqual(occurrenceDays("2026-10-14T08:00", { freq: "weekly", interval: 1, byDay: [0, 1, 2, 3, 4] }, "2026-10-21"), ["2026-10-14", "2026-10-15", "2026-10-16", "2026-10-19", "2026-10-20"]);
  assert.deepEqual(occurrenceDays("2026-10-12T10:00", { freq: "weekly", interval: 2, byDay: [0] }, "2026-11-20"), ["2026-10-12", "2026-10-26", "2026-11-09"]);
  // Until is inclusive.
  assert.deepEqual(occurrenceDays("2026-10-12T10:00", { freq: "weekly", interval: 1, until: "2026-10-26" }, "2027-01-01"), ["2026-10-12", "2026-10-19", "2026-10-26"]);
});

test("recurrence: monthly by day and by weekday, yearly on 29 February", () => {
  // The 31st: only the months that have one.
  assert.deepEqual(occurrenceDays("2026-01-31T09:00", { freq: "monthly", interval: 1 }, "2026-06-01"), ["2026-01-31", "2026-03-31", "2026-05-31"]);
  // The last Friday of the month (30 Oct 2026 is one).
  assert.deepEqual(occurrenceDays("2026-10-30T17:00", { freq: "monthly", interval: 1, monthlyBy: "weekday" }, "2027-01-01"), ["2026-10-30", "2026-11-27", "2026-12-25"]);
  // The second Tuesday.
  assert.deepEqual(occurrenceDays("2026-10-13T17:00", { freq: "monthly", interval: 1, monthlyBy: "weekday" }, "2026-12-31"), ["2026-10-13", "2026-11-10", "2026-12-08"]);
  assert.deepEqual(occurrenceDays("2028-02-29", { freq: "yearly", interval: 1 }, "2037-01-01"), ["2028-02-29", "2032-02-29", "2036-02-29"]);
});

test("recurrence: expanded into a range — durations, overnight, all-day, exceptions, daylight saving", () => {
  const weekly = parseRecurrence('{"freq":"weekly","interval":1}')!;
  const occ = expand({ start: "2026-10-05T23:00", end: "2026-10-06T01:00", allDay: false }, weekly, ["2026-10-19"], "2026-10-12", "2026-10-27");
  // The 12th's (reaching past midnight), not the 19th's (left out), the 26th's.
  assert.deepEqual(occ.map((o) => [o.start, o.end]), [
    ["2026-10-12T23:00", "2026-10-13T01:00"],
    ["2026-10-26T23:00", "2026-10-27T01:00"],
  ]);
  // One that starts before the range and reaches into it: there.
  assert.equal(expand({ start: "2026-10-05T23:00", end: "2026-10-06T01:00", allDay: false }, weekly, [], "2026-10-13T00:30", "2026-10-14").length, 1);
  // All-day, two days long.
  assert.deepEqual(expand({ start: "2026-12-24", end: "2026-12-26", allDay: true }, { freq: "yearly", interval: 1 }, [], "2027-12-20", "2027-12-31"), [{ start: "2027-12-24", end: "2027-12-26", occurrence: "2027-12-24" }]);
  // Across the change to winter time (25 Oct 2026): still 09:00–10:00 local.
  assert.deepEqual(expand({ start: "2026-10-19T09:00", end: "2026-10-19T10:00", allDay: false }, weekly, [], "2026-10-26", "2026-10-27")[0], { start: "2026-10-26T09:00", end: "2026-10-26T10:00", occurrence: "2026-10-26" });
});

test("recurrence: rules cleaned and described", () => {
  assert.equal(parseRecurrence({ freq: "hourly" }), null);
  assert.deepEqual(parseRecurrence({ freq: "weekly", interval: 0, byDay: [9, 2, 2], count: 5 }), { freq: "weekly", interval: 1, byDay: [2], count: 5 });
  assert.equal(describeRecurrence({ freq: "weekly", interval: 1, byDay: [0, 2] }, "2026-10-12"), "Weekly on Monday and Wednesday");
  assert.equal(describeRecurrence({ freq: "weekly", interval: 1, byDay: [0, 1, 2, 3, 4], count: 10 }, "2026-10-12"), "Weekly on weekdays, 10 times");
  assert.equal(describeRecurrence({ freq: "monthly", interval: 2, monthlyBy: "weekday" }, "2026-10-30"), "Every 2 months on the last Friday");
});
