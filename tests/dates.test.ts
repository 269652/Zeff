import assert from "node:assert/strict";
import test from "node:test";
import { addDays, localDay, localStamp, monthKey } from "@/lib/dates";

test("localDay is the local calendar day, not the UTC one", () => {
  assert.equal(localDay(new Date(2026, 0, 5, 0, 30)), "2026-01-05");
  assert.equal(localDay(new Date(2026, 11, 31, 23, 59)), "2026-12-31");
  assert.match(localDay(), /^\d{4}-\d{2}-\d{2}$/);
});

test("localStamp has the local hours and minutes", () => {
  assert.equal(localStamp(new Date(2026, 2, 9, 7, 4, 59)), "2026-03-09T07:04");
});

test("monthKey is YYYY-MM", () => {
  assert.equal(monthKey(new Date(2026, 8, 30)), "2026-09");
});

test("addDays counts calendar days across months, years and DST", () => {
  assert.equal(addDays("2026-01-31", 1), "2026-02-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-28", 2), "2026-03-30");
  assert.equal(addDays("2026-10-24", 7), "2026-10-31");
  assert.equal(addDays("2026-05-10T12:00", 0), "2026-05-10");
});
