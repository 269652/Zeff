import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** A week with bookings on two jobs — the weekly report's sums. */
test("the weekly report adds up", async () => {
  const { createJob } = await import("@/lib/jobs");
  const { createEntry, getWeeklyReport } = await import("@/lib/entries");
  const { resolveWeek } = await import("@/lib/week");

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
});
