import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** Wochenabschluss: a past week's steps — what's missing, what's left, and Chrono/Punch unknown until pulled. */
test("a week's closing steps say what's left", async () => {
  const { createJob } = await import("@/lib/jobs");
  const { createProject } = await import("@/lib/projects");
  const { createEntry } = await import("@/lib/entries");
  const { suggestEntry } = await import("@/lib/work/suggestions");
  const { weekClose } = await import("@/lib/week-close");
  const { resolveWeek } = await import("@/lib/week");
  createJob({ number: "300001", name: "Kunde" });
  const week = resolveWeek("2026-W40")!; // Mo 28.9. – So 4.10.
  const book = (date: string, hours: number) => createEntry({ jobNumber: "300001", date, hours, description: "Arbeit" }, "web");
  // Mo–Do full, Fr 6 of 8 hours.
  for (const d of ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"]) book(d, 8);
  book("2026-10-02", 6);
  // An entry of a project without a job, and an agent's suggestion for the week.
  const p = createProject({ title: "Ohne Job" });
  createEntry({ projectId: p.id, date: "2026-10-02", hours: 1, description: "Konzept" }, "web");
  suggestEntry({ date: "2026-10-01", hours: 0.5, description: "Review", reportedBy: "Claude" });

  const c = await weekClose(week, new Date(2026, 9, 7, 10)); // the Wednesday after
  const by = Object.fromEntries(c.items.map((i) => [i.key, i]));
  assert.equal(c.over, true);
  assert.equal(c.done, false);
  // Friday: 7 of 8 booked (6 + the 1 without job) — 1 h missing.
  assert.equal(by.hours.state, "open");
  assert.match(by.hours.detail, /Fr 1 h/);
  assert.equal(by.suggestions.state, "open");
  assert.match(by.suggestions.detail, /1 offen/);
  assert.equal(by.jobs.state, "open");
  assert.match(by.jobs.detail, /1 ohne Job/);
  // Chrono and Punch never pulled: not known — not done.
  assert.equal(by.chrono?.state, "unknown");
  assert.equal(by.approved?.state, "unknown");
  assert.equal(by.punch?.state, "unknown");
});

test("the running week: what's ahead isn't due yet", async () => {
  const { weekClose } = await import("@/lib/week-close");
  const { resolveWeek } = await import("@/lib/week");
  const c = await weekClose(resolveWeek("2026-W42")!, new Date(2026, 9, 13, 10)); // Tuesday of that week, nothing booked
  const hours = c.items.find((i) => i.key === "hours")!;
  assert.equal(c.over, false);
  // Monday is over and empty: open — the rest of the week isn't due.
  assert.equal(hours.state, "open");
  assert.match(hours.detail, /Mo 8 h/);
  assert.doesNotMatch(hours.detail, /Di|Mi/);
});
