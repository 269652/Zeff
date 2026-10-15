import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** The Feierabend booking: lines booked as taken over, a meeting never twice, a bad line named (the rest booked). */
test("a day is booked as taken over", async () => {
  const { createJob } = await import("@/lib/jobs");
  const { listEntries } = await import("@/lib/entries");
  const { bookDay } = await import("@/lib/feierabend");
  createJob({ number: "200001", name: "Kunde" });
  const date = "2026-10-12";
  const meeting = { kind: "meeting" as const, hours: 1, jobNumber: "200001", description: "Daily", ticket: null, externalId: "msgraph:test@2026-10-12T09:00" };

  const r = await bookDay(date, [
    meeting,
    { kind: "ticket", hours: 2.5, jobNumber: "200001", description: "Login-Fehler behoben", ticket: "ABC-7" },
    { kind: "ticket", hours: 0, jobNumber: "200001", description: "keine Stunden", ticket: "ABC-8" },
    { kind: "ticket", hours: 1, jobNumber: "", description: "kein Job", ticket: "ABC-9" },
  ]);
  assert.equal(r.booked, 2);
  assert.equal(r.hours, 3.5);
  assert.equal(r.errors.length, 2);

  // The same meeting again: skipped, not booked twice.
  const again = await bookDay(date, [meeting]);
  assert.equal(again.booked, 0);
  assert.equal(again.skipped, 1);

  const entries = listEntries({ from: date, to: date });
  assert.equal(entries.length, 2);
  assert.equal(entries.reduce((s, e) => s + e.hours, 0), 3.5);
  assert.ok(entries.some((e) => e.ticket === "ABC-7" && e.source === "web"));
  assert.ok(entries.some((e) => e.source === "calendar"));
});

/** Undo of a booking: deletes only what it created and what is still as booked. */
test("undoing a booking deletes only the created, untouched entries", async () => {
  const { createJob } = await import("@/lib/jobs");
  const { listEntries, createEntry } = await import("@/lib/entries");
  const { bookDay, undoBooking } = await import("@/lib/feierabend");
  const { getDb, schema } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  createJob({ number: "200002", name: "Undo" });
  const date = "2026-10-13";
  const other = createEntry({ jobNumber: "200002", date, hours: 1, description: "Hand booked", reportedBy: "Me" }, "web");
  const r = await bookDay(date, [
    { kind: "ticket", hours: 1, jobNumber: "200002", description: "A", ticket: "UND-1", standalone: true },
    { kind: "ticket", hours: 2, jobNumber: "200002", description: "B", ticket: "UND-2", standalone: true },
    { kind: "ticket", hours: 3, jobNumber: "200002", description: "C", ticket: "UND-3", standalone: true },
  ]);
  assert.equal(r.created.length, 3);
  // One is edited afterwards (a later timestamp), one is gone already.
  const [a, b, c] = r.created;
  getDb().update(schema.timeEntries).set({ updatedAt: "2099-01-01 00:00:00" }).where(eq(schema.timeEntries.id, a.id)).run();
  getDb().delete(schema.timeEntries).where(eq(schema.timeEntries.id, b.id)).run();

  const u = await undoBooking([...r.created, { id: other.id, updatedAt: "1999-01-01 00:00:00" }]);
  assert.equal(u.deleted, 1); // c
  assert.equal(u.kept, 2); // a (edited), other (not as stamped)
  const ids = listEntries({ from: date, to: date }).map((e) => e.id);
  assert.ok(ids.includes(a.id) && ids.includes(other.id));
  assert.ok(!ids.includes(c.id) && !ids.includes(b.id));
});
