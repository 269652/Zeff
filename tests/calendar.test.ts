import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { setupTempData } from "./helpers";

// Outlook's inbox too in the throwaway folder (not the real data/calendar-inbox.json).
process.env.ZEFF_CALENDAR_INBOX = path.join(setupTempData(), "calendar-inbox.json");
process.env.GCAL_NO_SERVER = "1";

/** Zeff's calendar model: own calendars, a source's appointments replaced by range, busy times only from busy calendars. */
test("calendar model: own and source calendars, ranges, busy times", async () => {
  const ir = await import("@/lib/calendar/ir");
  const own = ir.createCalendar("Privat", "#55B080");
  const e = ir.addEvent(own.id, { title: "Geschenk besorgen", start: "2026-10-14T18:00", end: "2026-10-14T19:00" });
  assert.equal(e.title, "Geschenk besorgen");

  const g = ir.ensureCalendar("google:me@example.com", { source: "google", name: "Ich" });
  const bday = ir.ensureCalendar("google:birthdays@birthdays.google.com", { source: "google", name: "Geburtstage", busy: false });
  ir.replaceEvents(g.id, [
    { key: "a", title: "Tatort", start: "2026-10-11T20:00", end: "2026-10-11T22:00" },
    { key: "b", title: "Alt", start: "2026-09-01T10:00", end: "2026-09-01T11:00" },
  ]);
  ir.replaceEvents(bday.id, [{ key: "n", title: "Nadine", start: "2026-10-16", end: "2026-10-17", allDay: true }]);
  // A sync of October: what was there in October goes, September's stays.
  ir.replaceEvents(g.id, [{ key: "c", title: "Kino", start: "2026-10-12T19:00", end: "2026-10-12T21:00" }], { from: "2026-10-01", to: "2026-11-01" });
  const titles = ir.eventsBetween("2026-08-01", "2026-12-01").map((x) => x.title);
  assert.deepEqual(titles.sort(), ["Alt", "Geschenk besorgen", "Kino", "Nadine"]);

  const busy = ir.busyBetween(new Date("2026-10-10T00:00:00"), new Date("2026-10-20T00:00:00")).map((b) => b.title);
  assert.deepEqual(busy.sort(), ["Geschenk besorgen", "Kino"]);

  // Hidden calendars are still busy; only "Belegt" counts.
  ir.updateCalendar(g.id, { visible: false });
  assert.equal(ir.eventsBetween("2026-10-12", "2026-10-13", { visible: true }).length, 0);
  assert.equal(ir.busyBetween(new Date("2026-10-12T00:00:00"), new Date("2026-10-13T00:00:00")).length, 1);

  assert.throws(() => ir.deleteCalendar(g.id), /Only Zeff's own calendars/);
  assert.throws(() => ir.addEvent(g.id, { title: "x", start: "2026-10-12T10:00", end: "2026-10-12T11:00" }), /only be created in Zeff's own/);
});

/** Outlook's record goes into the model and comes back unchanged (booking reads it Outlook's way). */
test("calendar model: Outlook's event round-trips", async () => {
  const ir = await import("@/lib/calendar/ir");
  const graph = {
    id: "AAMk1",
    iCalUId: "ical-1",
    subject: "PROJ-415 Abstimmung",
    start: { dateTime: "2026-10-13T10:00:00.0000000" },
    end: { dateTime: "2026-10-13T10:30:00.0000000" },
    isAllDay: false,
    isCancelled: false,
    showAs: "tentative",
    responseStatus: { response: "accepted" },
    organizer: { emailAddress: { name: "Anna", address: "anna@example.com" } },
    webLink: "https://outlook.office.com/x",
  };
  const input = ir.fromGraph(graph);
  assert.equal(input.start, "2026-10-13T10:00");
  assert.equal(input.showAs, "tentative");
  const cal = ir.ensureCalendar("outlook-test", { source: "outlook", name: "Outlook", book: true });
  ir.replaceEvents(cal.id, [input]);
  assert.deepEqual(ir.bookableGraphEvents(), [graph]);
});

/** Google Calendar's screen-reader lines read as appointments. */
test("Google Calendar lines", async () => {
  const { parseLine } = (await import("../src/plugins/google-calendar/driver.mjs")) as { parseLine: (l: string) => Record<string, unknown> | null };
  assert.deepEqual(parseLine("20:00 bis 22:00, Tatort, Moritz Roessler, Ort: Anna-Müller-Weg, Farbe: Lavendel, 18. Oktober 2026"), {
    start: "2026-10-18T20:00",
    end: "2026-10-18T22:00",
    allDay: false,
    title: "Tatort",
    location: "Anna-Müller-Weg",
  });
  assert.deepEqual(parseLine("Ganztägig, Nadine, Geburtstage, Kein Ort, 16. Oktober 2026"), { start: "2026-10-16", end: "2026-10-17", allDay: true, title: "Nadine", location: "" });
  assert.equal(parseLine("23:00 bis 01:00, Party, X, Kein Ort, 17. Oktober 2026")?.end, "2026-10-18T01:00");
  assert.equal(parseLine("irgendwas"), null);
});

/** Appointments of today and tomorrow as todos — in Zeff's own calendars (by default), once each. */
test("calendar todos: today's and tomorrow's appointments, once", async () => {
  const ir = await import("@/lib/calendar/ir");
  const { calendarTodos } = await import("@/lib/calendar/todos");
  const { listTodos } = await import("@/lib/todos/store");
  const own = ir.createCalendar("Haushalt");
  assert.equal(own.todos, true);
  ir.addEvent(own.id, { title: "Kleider waschen", start: "2026-11-02T12:45", end: "2026-11-02T14:00" });
  ir.addEvent(own.id, { title: "Müll rausbringen", start: "2026-11-03", end: "2026-11-04", allDay: true });
  ir.addEvent(own.id, { title: "Später", start: "2026-11-04T10:00", end: "2026-11-04T11:00" });
  // One made for a todo (a proposal accepted): that todo gets the day, no second todo.
  const { addManualTodo, getTodo } = await import("@/lib/todos/store");
  const asked = addManualTodo({ ticket: "", text: "Geschenk besorgen" });
  ir.addEvent(own.id, { title: "Geschenk besorgen", start: "2026-11-02T18:00", end: "2026-11-02T19:00", todoId: asked.id });
  const g = ir.ensureCalendar("google:todo-test@example.com", { source: "google", name: "Google" });
  assert.equal(g.todos, false);
  ir.replaceEvents(g.id, [{ key: "x", title: "Tatort", start: "2026-11-02T20:00", end: "2026-11-02T22:00" }]);

  const now = new Date("2026-11-02T08:00:00");
  assert.equal(await calendarTodos(now), 2);
  assert.equal(await calendarTodos(now), 0);
  assert.equal(getTodo(asked.id)?.due, "2026-11-02");
  const made = listTodos({ status: "open" }).filter((t) => t.source?.startsWith("Kalender"));
  assert.deepEqual(made.map((t) => [t.text, t.due]).sort(), [
    ["Kleider waschen (12:45)", "2026-11-02"],
    ["Müll rausbringen", "2026-11-03"],
  ]);
});
