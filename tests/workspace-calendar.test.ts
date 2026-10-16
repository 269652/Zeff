import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

test("the calendar is a database of the Workspace: made once, its rows the appointments, the calendar app its first view", async () => {
  const st = await import("@/plugins/state");
  st.setInstalled("workspace", true);
  st.setInstalled("calendar", true);
  const { addEvent, zeffCalendar } = await import("@/lib/calendar/ir");
  const own = zeffCalendar();
  const { dayOf } = await import("@/lib/calendar/ir-shared");
  const d = new Date();
  d.setDate(d.getDate() + 2);
  const day = dayOf(d);
  addEvent(own.id, { title: "Kickoff", start: `${day}T10:00`, end: `${day}T11:00`, allDay: false, location: "Room 4" });
  const { ensureCalendarDatabase, calendarDatabase } = await import("@/plugins/workspace/calendar-database");
  const store = await import("@/plugins/workspace/store");
  await ensureCalendarDatabase();
  const id = calendarDatabase();
  assert.ok(id, "the database is made");
  const db = store.getDatabase(id!)!;
  assert.equal(db.schema.dataType, "calendar");
  assert.equal(db.schema.views[0].type, "app");
  assert.equal(db.schema.views[0].app, "calendar");
  const rows = store.rowsOf(id!)!.rows;
  assert.ok(rows.some((r) => r.title === "Kickoff"), "the appointment is a row");
  // Once: a second call makes nothing new, and a gone database is not made again.
  await ensureCalendarDatabase();
  assert.equal(calendarDatabase(), id);
  store.archivePage(id!);
  await ensureCalendarDatabase();
  assert.equal(calendarDatabase(), null);
});

test("the calendar database is a two-way view: edits of a row go to Zeff's appointment, a new row makes one, deleting a row deletes it, Google's stay read-only", async () => {
  const st = await import("@/plugins/state");
  st.setInstalled("workspace", true);
  st.setInstalled("calendar", true);
  const ir = await import("@/lib/calendar/ir");
  const { dayOf } = await import("@/lib/calendar/ir-shared");
  const store = await import("@/plugins/workspace/store");
  const { calendarDatabase, ensureCalendarDatabase } = await import("@/plugins/workspace/calendar-database");
  const { runPipeline } = await import("@/plugins/workspace/pipeline");
  const { removeFromSource } = await import("@/plugins/workspace/source-write");
  const day = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return dayOf(d);
  };
  const own = ir.zeffCalendar();
  const mine = ir.addEvent(own.id, { title: "Planning", start: `${day(3)}T09:00`, end: `${day(3)}T10:00`, allDay: false });
  const google = ir.ensureCalendar("google:test", { source: "google", name: "Work" });
  ir.replaceEvents(google.id, [{ key: "g1", title: "Board meeting", start: `${day(3)}T13:00`, end: `${day(3)}T14:00`, allDay: false }]);
  // (The first test left its database in the trash.)
  const gone = (await import("@/lib/prefs")).getPref<number | null>("workspace.calendarDb", null);
  if (gone) store.restorePage(gone);
  await ensureCalendarDatabase();
  const id = calendarDatabase()!;
  await runPipeline(id, { ai: false });
  const rowOf = (title: string) => store.rowsOf(id)!.rows.find((r) => r.title === title)!;
  // An edit of the row: title, start, place - written to the appointment.
  const row = rowOf("Planning");
  store.updatePage(row.id, { title: "Sprint planning" });
  store.setCell(row.id, "calstart", `${day(3)}T09:30`);
  store.setCell(row.id, "calplace", "Room 2");
  await runPipeline(id, { ai: false });
  const after = ir.eventById(mine.id)!;
  assert.equal(after.title, "Sprint planning");
  assert.equal(after.start, `${day(3)}T09:30`);
  assert.equal(after.location, "Room 2");
  assert.ok(after.end > after.start, "an end after the start");
  assert.equal(rowOf("Sprint planning").cells.calplace, "Room 2", "the row follows what the calendar holds");
  // Changed in the calendar since the row was read: the calendar wins.
  ir.updateEvent(mine.id, { title: "Planning (moved)" });
  store.updatePage(rowOf("Sprint planning").id, { title: "Ignored edit" });
  await runPipeline(id, { ai: false });
  assert.equal(ir.eventById(mine.id)!.title, "Planning (moved)");
  // Google's is read-only: the edit is lost at the next read.
  const g = rowOf("Board meeting");
  store.updatePage(g.id, { title: "Hijacked" });
  await runPipeline(id, { ai: false });
  assert.equal(ir.eventsBetween(day(3), day(4)).find((e) => e.key === "g1")!.title, "Board meeting");
  await assert.rejects(() => removeFromSource(rowOf("Board meeting").id), /delete it there/);
  // A new row with a title is a new appointment of Zeff's calendar.
  const fresh = store.addRow(id, { title: "Dentist", cells: { calstart: `${day(5)}T08:00` } });
  await runPipeline(id, { ai: false });
  const made = ir.eventsBetween(day(5), day(6)).find((e) => e.title === "Dentist");
  assert.ok(made && made.calendar.source === "zeff" && made.start === `${day(5)}T08:00`);
  assert.equal(String(store.getPage(fresh)!.props.srcref), `event:${made!.id}`);
  // Deleting the row deletes the appointment.
  await removeFromSource(fresh);
  store.archivePage(fresh);
  assert.equal(ir.eventById(made!.id), null);
});

test("a calendar database that is only a table (no data type, no calendar view) is mended", async () => {
  const st = await import("@/plugins/state");
  st.setInstalled("workspace", true);
  st.setInstalled("calendar", true);
  const store = await import("@/plugins/workspace/store");
  const { setPref } = await import("@/lib/prefs");
  const { newView } = await import("@/plugins/workspace/model");
  const { ensureCalendarDatabase, calendarDatabase } = await import("@/plugins/workspace/calendar-database");
  const id = store.createPage({ kind: "database", title: "Calendar", schema: { titleName: "Name", properties: [], views: [newView("Table", "table")], pipeline: { steps: [{ id: "s1", kind: "source", from: "ext", ext: "calendar" }] } } });
  setPref("workspace.calendarDb", id);
  assert.equal(calendarDatabase(), id);
  assert.equal(store.getDatabase(id)!.schema.dataType, undefined);
  await ensureCalendarDatabase();
  const s = store.getDatabase(id)!.schema;
  assert.equal(s.dataType, "calendar");
  assert.equal(s.views[0].type, "app");
  assert.equal(s.views[0].app, "calendar");
  assert.equal(s.views.length, 2, "its table stays");
  // Mended once: nothing more is added.
  await ensureCalendarDatabase();
  assert.equal(store.getDatabase(id)!.schema.views.length, 2);
});

test("the calendar is an app of its own without the Workspace (a header tab); with it the tab gives way", async () => {
  const st = await import("@/plugins/state");
  const { PLUGINS } = await import("@/plugins/catalog");
  const { allApps } = await import("@/plugins/tabs");
  assert.equal(PLUGINS.find((p) => p.id === "calendar")!.defaultInstalled, true, "installed from the start");
  st.setInstalled("calendar", true);
  st.setInstalled("workspace", false);
  assert.ok(allApps().some((a) => a.href === "/kalender" && a.place === "header"), "a tab without the Workspace");
  st.setInstalled("workspace", true);
  assert.ok(!allApps().some((a) => a.href === "/kalender"), "no tab with the Workspace");
});
