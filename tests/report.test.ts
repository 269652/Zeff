import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** A week with bookings on two jobs — the weekly report's sums and the Roar export built from them. */
test("weekly report and Roar export add up", async () => {
  const { createJob } = await import("@/lib/jobs");
  const { createEntry, getWeeklyReport } = await import("@/lib/entries");
  const { resolveWeek } = await import("@/lib/week");
  const { getRoarExportPlan, roundRoarHours, roarComment } = await import("@/lib/roar");

  createJob({ number: "100001", name: "Kunde A" });
  createJob({ number: "100002", name: "Kunde B" });
  const week = resolveWeek("2026-10-05")!; // Monday 5 Oct 2026
  const book = (date: string, jobNumber: string, hours: number, description: string, ticket?: string) =>
    createEntry({ jobNumber, date, hours, description, ticket, reportedBy: "test" }, "web");
  book("2026-10-05", "100001", 1.5, "Konzept", "ABC-1");
  book("2026-10-05", "100002", 2.25, "Meeting");
  book("2026-10-06", "100001", 4, "Umsetzung", "ABC-1");
  book("2026-10-07", "100002", 0.25, "Abstimmung");

  const r = getWeeklyReport(week);
  assert.equal(r.total, 8);
  assert.deepEqual(r.dayTotals, [3.75, 4, 0.25, 0, 0, 0, 0]);
  const a = r.rows.find((x) => x.job.number === "100001")!;
  const b = r.rows.find((x) => x.job.number === "100002")!;
  assert.equal(a.total, 5.5);
  assert.equal(b.total, 2.5);

  // Roar takes tenths, rounded up — never less than booked.
  assert.equal(roundRoarHours(2.25), 2.3);
  assert.equal(roundRoarHours(0.25), 0.3);
  assert.equal(roundRoarHours(4), 4);
  assert.equal(roarComment("ABC-1", "Konzept"), "ABC-1: Konzept");
  assert.equal(roarComment(null, "x".repeat(200)).length, 125);

  const plan = getRoarExportPlan(week);
  const jobs = plan.rows.map((x) => x.jobNumber).sort();
  assert.deepEqual(jobs, ["100001", "100002"]);
  const exported = plan.rows.flatMap((row) => Object.values(row.entriesByDay).flat() as { hours: number }[]);
  const sum = exported.reduce((s, e) => s + e.hours, 0);
  // At least what was booked (rounding up), and not wildly more.
  assert.ok(sum >= 8 - 1e-9, `exported ${sum}`);
  assert.ok(sum <= 8 + 0.1 * exported.length + 1e-9, `exported ${sum}`);
});
