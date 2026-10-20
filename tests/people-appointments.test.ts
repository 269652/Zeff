import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const now = new Date("2026-10-20T12:00:00");

async function setup() {
  const { createPerson, getPerson } = await import("@/plugins/people/store");
  const { createCalendar, addEvent } = await import("@/lib/calendar/ir");
  const id = createPerson({ name: "Ulla Nathanael", aliases: ["Nathanael"], emails: ["OGV.Nathanael@gvjustiz.de"] });
  const cal = createCalendar("Privat");
  const add = (title: string, start: string, end: string, more: { attendees?: string[]; description?: string; allDay?: boolean; organizer?: string } = {}) => addEvent(cal.id, { title, start, end, ...more });
  add("Termin Amtsgericht", "2026-10-22T10:00", "2026-10-22T11:00", { attendees: ["Ulla N. <ogv.nathanael@gvjustiz.de>", "ich@example.org"] });
  add("Ratenvereinbarung besprechen", "2026-10-25T09:00", "2026-10-25T09:30", { description: "Mit Frau Nathanael die Raten durchgehen." });
  add("Akte abholen", "2026-10-20", "2026-10-21", { allDay: true, organizer: "ogv.nathanael@gvjustiz.de" });
  add("Telefonat", "2026-10-10T14:00", "2026-10-10T14:15", { attendees: ["Ulla Nathanael"] });
  add("Vorgespräch Nathanael", "2026-10-20T08:00", "2026-10-20T09:00");
  add("Nathanael: alte Sache", "2026-09-01T10:00", "2026-09-01T11:00");
  add("Nathanael: viel später", "2026-12-01T10:00", "2026-12-01T11:00");
  add("Zahnarzt", "2026-10-23T10:00", "2026-10-23T11:00", { attendees: ["praxis@example.org"] });
  return { id, person: getPerson(id)! };
}

test("appointments with a person: upcoming (next 30 days, the soonest first) and recent (last 30 days, the latest first) — an attendee by address or name, or named in the title or description", async () => {
  const { id, person } = await setup();
  const { eventsBetween } = await import("@/lib/calendar/ir");
  const { appointmentsWith, appointmentsOf } = await import("@/plugins/people/appointments");
  const events = eventsBetween("2026-08-01T00:00", "2027-01-01T00:00");
  const r = appointmentsWith(person, events, now);
  assert.deepEqual(r.upcoming.map((e) => e.title), ["Akte abholen", "Termin Amtsgericht", "Ratenvereinbarung besprechen"]);
  assert.deepEqual(r.recent.map((e) => e.title), ["Vorgespräch Nathanael", "Telefonat"]);
  // A cancelled one isn't.
  const { getDb, schema } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  getDb().update(schema.calendarEvents).set({ cancelled: true }).where(eq(schema.calendarEvents.title, "Telefonat")).run();
  // From the store, with where each opens.
  const of = (await appointmentsOf(id, now))!;
  assert.deepEqual(of.recent.map((e) => e.title), ["Vorgespräch Nathanael"]);
  assert.equal(of.upcoming[0].allDay, true);
  assert.match(of.upcoming[1].href, /d=2026-10-22/);
  assert.equal(of.upcoming[1].calendar, "Privat");
});

test("appointments with a person: none without the Calendar plugin", async () => {
  const { setInstalled } = await import("@/plugins/state");
  const { listPeople } = await import("@/plugins/people/store");
  const { appointmentsOf } = await import("@/plugins/people/appointments");
  const id = listPeople()[0].id;
  setInstalled("calendar", false);
  assert.equal(await appointmentsOf(id, now), null);
  setInstalled("calendar", true);
  assert.ok(await appointmentsOf(id, now));
});

test("appointments with a person: in the bundle of their page (events) — null without the Calendar plugin", async () => {
  const { setInstalled } = await import("@/plugins/state");
  const { listPeople } = await import("@/plugins/people/store");
  const { personBundle } = await import("@/plugins/people/blocks");
  const id = listPeople().find((p) => p.name === "Ulla Nathanael")!.id;
  const b = await personBundle(id);
  assert.ok(b.events, "the calendar is installed");
  assert.ok(Array.isArray(b.events.upcoming) && Array.isArray(b.events.recent));
  setInstalled("calendar", false);
  assert.equal((await personBundle(id)).events, null);
  setInstalled("calendar", true);
});
