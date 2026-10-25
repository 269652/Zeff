import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * The daily series the correlations compare: a Workspace database with a date (its numbers, a select as its option's place, each tag
 * of a multi-select as 0/1) and Zeff's own signals — meeting hours, booked hours, messages in and out per channel, todos made and
 * done, spending, the first and last activity of the day. A signal's day without anything is a 0 from its first record on.
 */

const at = (day: string, h: number, m = 0) => {
  const [y, mo, d] = day.split("-").map(Number);
  return new Date(y, mo - 1, d, h, m).toISOString();
};

async function world() {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "correlations", "calendar", "zeiterfassung", "teams", "finances", "cases", "todos"]) setInstalled(id, true);
  await import("@/plugins/contributions");
  return await import("@/plugins/correlations/series");
}

test("a Workspace database with a date: numbers, a select by its option's place, tags as 0/1 — the days without an entry are missing", async () => {
  const series = await world();
  const store = await import("@/plugins/workspace/store");
  const { newProperty } = await import("@/plugins/workspace/model");
  const db = store.createPage({ title: "Journal", kind: "database" });
  const date = newProperty("Date", "date");
  const mood = { ...newProperty("Mood", "select"), options: ["Hard", "Meh", "Okay", "Good", "Great"].map((n, i) => ({ id: `m${i}`, name: n, color: "gray" })) };
  const energy = newProperty("Energy", "number");
  const tags = { ...newProperty("Tags", "multi_select"), options: [{ id: "tw", name: "Work", color: "blue" }, { id: "tf", name: "Family", color: "green" }] };
  store.updateSchema(db, { ...store.getDatabase(db)!.schema, properties: [date, mood, energy, tags] });
  store.addRow(db, { title: "One", cells: { [date.id]: "2026-10-01", [mood.id]: "m3", [energy.id]: 4, [tags.id]: ["tf"] } });
  store.addRow(db, { title: "Two", cells: { [date.id]: "2026-10-02", [mood.id]: "m0", [energy.id]: 2, [tags.id]: ["tw"] } });
  store.addRow(db, { title: "Three", cells: { [date.id]: "2026-10-04", [energy.id]: 3 } });
  // An undated row counts nowhere.
  store.addRow(db, { title: "No date", cells: { [energy.id]: 5 } });

  const all = await series.allSeries({ from: "2026-10-01", to: "2026-10-05" });
  const by = (id: string) => all.find((s) => s.id === id);
  const e = by(`db:${db}:${energy.id}`)!;
  assert.equal(e.label, "Journal › Energy");
  assert.equal(e.kind, "number");
  assert.deepEqual([...e.values], [["2026-10-01", 4], ["2026-10-02", 2], ["2026-10-04", 3]]);
  const m = by(`db:${db}:${mood.id}`)!;
  assert.equal(m.kind, "ordinal");
  assert.deepEqual(m.levels, ["Hard", "Meh", "Okay", "Good", "Great"]);
  assert.deepEqual([...m.values], [["2026-10-01", 4], ["2026-10-02", 1]], "Good is the 4th step, Hard the 1st; no mood on the 4th");
  const fam = by(`db:${db}:${tags.id}:tf`)!;
  assert.equal(fam.label, "Journal › Tags: Family");
  assert.equal(fam.kind, "binary");
  assert.deepEqual([...fam.values], [["2026-10-01", 1], ["2026-10-02", 0], ["2026-10-04", 0]], "a tag: 1 or 0 on every day with an entry");

  // Found by the database's and the field's name (any case), a tag as "Field: Option".
  assert.equal(series.findSeries(all, { database: "journal", field: "energy" })?.id, e.id);
  assert.equal(series.findSeries(all, { database: "Journal", field: "Tags: family" })?.id, fam.id);
  assert.equal(series.findSeries(all, { field: e.id })?.id, e.id, "or by its id");
  assert.equal(series.findSeries(all, { database: "Journal", field: "Nope" }), null);
});

test("Zeff's own signals per day: meeting hours (overlaps once, declined and all-day not), booked hours, messages in and out, todos, spending, first and last activity", async () => {
  const series = await world();
  const { addEvent, zeffCalendar } = await import("@/lib/calendar/ir");
  const cal = zeffCalendar("Work");
  addEvent(cal.id, { title: "Standup", start: "2026-10-01T09:00", end: "2026-10-01T10:00" });
  addEvent(cal.id, { title: "Overlap", start: "2026-10-01T09:30", end: "2026-10-01T11:00" });
  addEvent(cal.id, { title: "Declined", start: "2026-10-01T14:00", end: "2026-10-01T15:00", response: "declined" });
  addEvent(cal.id, { title: "Holiday", start: "2026-10-02", end: "2026-10-03", allDay: true });
  addEvent(cal.id, { title: "Review", start: "2026-10-03T13:00", end: "2026-10-03T13:30" });

  const { getSqlite } = await import("@/db");
  const { createJob } = await import("@/lib/jobs");
  const job = createJob({ number: "J-1", name: "Work" });
  const ins = getSqlite().prepare("insert into time_entries (job_id, date, hours, description, start, created_at, updated_at) values (?, ?, ?, 'x', ?, '2026-10-01', '2026-10-01')");
  ins.run(job.id, "2026-10-01", 2, "08:15");
  ins.run(job.id, "2026-10-01", 1.5, null);
  ins.run(job.id, "2026-10-03", 3, "10:00");

  const { saveMails } = await import("@/lib/mail/store");
  saveMails([
    { convId: "M1", folder: "Posteingang", from: "Anna", fromEmail: "", subject: "Hi", preview: "a", receivedAt: at("2026-10-01", 12), unread: false },
    { convId: "M2", folder: "Posteingang", from: "Ben", fromEmail: "", subject: "Ho", preview: "b", receivedAt: at("2026-10-01", 13), unread: false },
    { convId: "wa:1", folder: "WhatsApp", from: "Cora", fromEmail: "", subject: "Cora", preview: "hey", receivedAt: at("2026-10-02", 9), unread: false },
    { convId: "wa:1", folder: "WhatsApp", from: "Ich", fromEmail: "", subject: "Cora", preview: "hi!", receivedAt: at("2026-10-02", 22, 30), unread: false },
  ]);
  const { saveTeamsMessages } = await import("@/lib/teams/store");
  const tm = (key: string, kind: "pm" | "chat", senderId: string, day: string, h: number) => ({ key, kind, mentionType: null, conversationId: "c1", replyChainId: null, messageId: key, place: "Chat", senderName: senderId, senderId, sentAt: new Date(at(day, h)).getTime(), subject: null, html: "x", text: "x", link: "", isRead: true });
  saveTeamsMessages([tm("t1", "pm", "anna", "2026-10-01", 10), tm("t2", "chat", "me", "2026-10-01", 7), tm("t3", "chat", "me", "2026-10-03", 18)]);

  const todo = getSqlite().prepare("insert into todos (ticket, text, created_at, updated_at, done_at, status) values ('', 'x', ?, ?, ?, ?)");
  todo.run(at("2026-10-01", 9), at("2026-10-01", 9), at("2026-10-02", 9), "done");
  todo.run(at("2026-10-01", 10), at("2026-10-01", 10), null, "open");

  const { addBookings } = await import("@/plugins/cases/bank");
  addBookings(
    [
      { date: "2026-10-01", amount: -12.5, currency: "EUR", text: "Café", counterparty: "", iban: "", reference: "" },
      { date: "2026-10-01", amount: -7.5, currency: "EUR", text: "Bus", counterparty: "", iban: "", reference: "" },
      { date: "2026-10-01", amount: 1000, currency: "EUR", text: "Salary", counterparty: "", iban: "", reference: "" },
      { date: "2026-10-03", amount: -30, currency: "EUR", text: "Food", counterparty: "", iban: "", reference: "" },
    ],
    "Giro",
  );

  const all = await series.allSeries({ from: "2026-10-01", to: "2026-10-03" });
  const v = (id: string) => {
    const s = all.find((x) => x.id === id);
    assert.ok(s, `${id} is there (${all.map((x) => x.id).join(", ")})`);
    return Object.fromEntries(s.values);
  };
  assert.deepEqual(v("calendar:meeting-hours"), { "2026-10-01": 2, "2026-10-02": 0, "2026-10-03": 0.5 });
  assert.deepEqual(v("time:booked-hours"), { "2026-10-01": 3.5, "2026-10-02": 0, "2026-10-03": 3 });
  assert.deepEqual(v("messages:mail:received"), { "2026-10-01": 2, "2026-10-02": 0, "2026-10-03": 0 });
  assert.deepEqual(v("messages:whatsapp:received"), { "2026-10-02": 1, "2026-10-03": 0 }, "from the channel's first message on");
  assert.deepEqual(v("messages:whatsapp:sent"), { "2026-10-02": 1, "2026-10-03": 0 });
  assert.deepEqual(v("messages:teams:received"), { "2026-10-01": 1, "2026-10-02": 0, "2026-10-03": 0 });
  assert.deepEqual(v("messages:teams:sent"), { "2026-10-01": 1, "2026-10-02": 0, "2026-10-03": 1 });
  assert.deepEqual(v("todos:created"), { "2026-10-01": 2, "2026-10-02": 0, "2026-10-03": 0 });
  assert.deepEqual(v("todos:done"), { "2026-10-01": 0, "2026-10-02": 1, "2026-10-03": 0 });
  assert.deepEqual(v("finances:spending"), { "2026-10-01": 20, "2026-10-02": 0, "2026-10-03": 30 });
  // The first and last thing you did: a Teams message at 7:00, booked time 8:15–10:15; WhatsApp at 22:30; Teams at 18:00, booked 10:00–13:00.
  assert.deepEqual(v("activity:first"), { "2026-10-01": 7, "2026-10-02": 22.5, "2026-10-03": 10 });
  assert.deepEqual(v("activity:last"), { "2026-10-01": 10.25, "2026-10-02": 22.5, "2026-10-03": 18 });
});

test("another plugin adds its own series through the point — gone while it is uninstalled", async () => {
  const series = await world();
  const { correlationSeries } = await import("@/plugins/correlations/series-point");
  const { setInstalled } = await import("@/plugins/state");
  correlationSeries.contribute("news", [{ id: "news.read", series: () => [{ id: "news:read", label: "News read", group: "News", kind: "number", values: new Map([["2026-10-01", 3]]) }] }]);
  setInstalled("news", true);
  assert.ok((await series.allSeries({ from: "2026-10-01", to: "2026-10-03" })).some((s) => s.id === "news:read"));
  setInstalled("news", false);
  assert.ok(!(await series.allSeries({ from: "2026-10-01", to: "2026-10-03" })).some((s) => s.id === "news:read"));
});

test("a time of day: a date field with the time beside the row's date is read as hours of its day — after midnight past 24 (the day turns at 4:00)", async () => {
  const series = await world();
  const store = await import("@/plugins/workspace/store");
  const { newProperty } = await import("@/plugins/workspace/model");
  const db = store.createPage({ title: "Routine · Verlauf", kind: "database" });
  const date = newProperty("Datum", "date");
  const bed = { ...newProperty("Ins Bett · Erledigt um", "date"), includeTime: true };
  store.updateSchema(db, { ...store.getDatabase(db)!.schema, properties: [date, bed] });
  store.addRow(db, { title: "a", cells: { [date.id]: "2026-10-01", [bed.id]: "2026-10-01T22:45" } });
  store.addRow(db, { title: "b", cells: { [date.id]: "2026-10-02", [bed.id]: "2026-10-03T00:30" } });
  store.addRow(db, { title: "c", cells: { [date.id]: "2026-10-03" } });
  const s = (await series.allSeries({ from: "2026-10-01", to: "2026-10-05" })).find((x) => x.id === `db:${db}:${bed.id}`)!;
  assert.equal(s.kind, "number");
  assert.equal(s.unit, "h");
  assert.deepEqual([...s.values], [["2026-10-01", 22.75], ["2026-10-02", 24.5]], "no time: no value");
});
