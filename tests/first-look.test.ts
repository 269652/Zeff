import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * The first look (lib/first-look.ts): what Zeff finds in the last 30 days, on one page — the promises you made and forgot, what
 * falls due in the next 14 days, the cases with no next step, the work time not booked — each with one click to act on it.
 */
const day = (d: number) => new Date(Date.now() + d * 864e5).toLocaleDateString("sv-SE");

test("the first look: a forgotten promise, a debt falling due, unbooked work days — and what is fine stays out", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const p of ["people", "todos", "finances", "workspace", "cases", "zeiterfassung"]) setInstalled(p, true);
  const { createPerson } = await import("@/plugins/people/store");
  const p = createPerson({ name: "Mia Vergessen" });
  const { addClaim, claimsOf, reviewClaim } = await import("@/plugins/people/graph");
  addClaim({ personId: p, kind: "commitment", text: "Ich schicke Mia die Fotos", direction: "mine", due: day(-5), confidence: 0.9 });
  addClaim({ personId: p, kind: "commitment", text: "Ich rufe Mia an", direction: "mine", due: day(-3), confidence: 0.9 });
  reviewClaim(claimsOf(p).find((c) => c.text === "Ich rufe Mia an")!.id, "done");
  addClaim({ personId: p, kind: "commitment", text: "Mia gibt mir das Buch zurück", direction: "theirs", due: day(-2), confidence: 0.9 });
  const { ensureDebtsDatabase } = await import("@/plugins/finances/database");
  await ensureDebtsDatabase();
  const { createDebt } = await import("@/plugins/finances/own");
  createDebt({ dir: "owe", title: "Mia", creditorId: p, amount: 100, due: day(7), installment: null });
  createDebt({ dir: "owe", title: "Später", creditorId: p, amount: 100, due: day(60), installment: null });
  // Work: 8 h a weekday; one day booked in full, the rest not.
  const { updateWorkSchedule } = await import("@/lib/schedule");
  updateWorkSchedule({ mon: 8, tue: 8, wed: 8, thu: 8, fri: 8, sat: 0, sun: 0 } as never);
  const { getSqlite } = await import("@/db");
  const { createJob } = await import("@/lib/jobs");
  const job = createJob({ number: "J-1", name: "Work" });
  const booked = [...Array(30).keys()].map((i) => day(-1 - i)).find((d) => ![0, 6].includes(new Date(`${d}T12:00:00`).getDay()))!;
  getSqlite().prepare("insert into time_entries (job_id, date, hours, description, created_at, updated_at) values (?, ?, 8, 'x', ?, ?)").run(job.id, booked, booked, booked);

  const { firstLook } = await import("@/lib/first-look");
  const f = await firstLook();
  assert.deepEqual(f.promises.map((x) => x.text), ["Ich schicke Mia die Fotos"], "yours, overdue — the one you kept is out");
  assert.deepEqual(f.owedToYou.map((x) => x.text), ["Mia gibt mir das Buch zurück"]);
  assert.deepEqual(f.dueSoon.map((x) => x.title), ["Mia"], "in the next 14 days — the one in two months is out");
  assert.ok(f.unbooked.days.length >= 15, "the weekdays of 30 days without bookings");
  assert.ok(!f.unbooked.days.some((d) => d.date === booked), "the day booked in full is out");
  assert.equal(f.unbooked.hours, f.unbooked.days.reduce((s, d) => s + d.missing, 0));
  assert.ok(f.count >= 4, "how much it found, for the headline");
});
