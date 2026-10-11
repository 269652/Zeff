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
