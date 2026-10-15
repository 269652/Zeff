import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** Entries with a start time are the appointments of their own "Done" calendar. */
test("entries with a start are a calendar of what is done", async () => {
  const { createJob } = await import("@/lib/jobs");
  const { createEntry, deleteEntry } = await import("@/lib/entries");
  const { syncDoneCalendar, DONE_CALENDAR_KEY } = await import("@/lib/calendar/done");
  const { eventsBetween, listCalendars } = await import("@/lib/calendar/ir");
  const { applyParallel } = await import("@/lib/entry-parallel");
  const { setPauses } = await import("@/lib/pauses");
  createJob({ number: "300001", name: "Relaunch" });
  const day = "2026-12-21";
  setPauses([day], "12:00-12:30");
  const a = createEntry({ jobNumber: "300001", date: day, hours: 2, description: "Login", ticket: "PROJ-1", start: "11:00" }, "web");
  createEntry({ jobNumber: "300001", date: day, hours: 1, description: "Ohne Start" }, "web");
  const b = createEntry({ jobNumber: "300001", date: day, hours: 2, description: "Header", ticket: "PROJ-2", start: "11:00" }, "web");

  syncDoneCalendar("2026-12-21", "2026-12-22");
  const cal = listCalendars().find((c) => c.key === DONE_CALENDAR_KEY)!;
  assert.equal(cal.name, "Done");
  assert.deepEqual([cal.busy, cal.book, cal.todos, cal.visible], [false, false, false, true], "blocks no time, no booking, no todos");
  let events = eventsBetween("2026-12-21", "2026-12-22").filter((e) => e.calendarId === cal.id);
  assert.deepEqual(events.map((e) => [e.title, e.start, e.end]).sort(), [["PROJ-1: Login", "2026-12-21T11:00", "2026-12-21T13:30"], ["PROJ-2: Header", "2026-12-21T11:00", "2026-12-21T13:30"]]); // 2 h from 11:00, the lunch break inside it
  assert.ok(!events.some((e) => e.title === "Ohne Start"));
  assert.equal(eventsBetween("2026-12-21", "2026-12-22", { busy: true }).filter((e) => e.calendarId === cal.id).length, 0);

  // Grouped parallel work: each task with what it really worked (divided: its booked share is only said).
  applyParallel([a.id, b.id], "divide");
  syncDoneCalendar("2026-12-21", "2026-12-22");
  events = eventsBetween("2026-12-21", "2026-12-22").filter((e) => e.calendarId === cal.id);
  assert.deepEqual(events.map((e) => e.end).sort(), ["2026-12-21T13:30", "2026-12-21T13:30"]);
  assert.match(events.find((e) => e.title.startsWith("PROJ-1"))!.description, /2 h · 1 h booked/);

  // What is gone is gone from the calendar when it is read again.
  deleteEntry(b.id);
  syncDoneCalendar("2026-12-21", "2026-12-22");
  assert.equal(eventsBetween("2026-12-21", "2026-12-22").filter((e) => e.calendarId === cal.id).length, 1);
});
