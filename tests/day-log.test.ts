import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

// A list ticked through every day (the medicines): each tick at once in the day's entry of its log — the dose, the time it was taken
// (as hours of the day, after midnight past 24) —, untick: no time; after 4:00 the list starts the day unticked, the day before kept.

async function medis() {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("workspace", true);
  const w = await import("@/plugins/workspace/store");
  const db = w.createPage({
    kind: "database",
    title: "Medis",
    schema: {
      titleName: "Name",
      properties: [
        { id: "dose", name: "Dosis (mg)", type: "number" },
        { id: "took", name: "Genommen", type: "checkbox", stampTime: true },
      ],
      views: [{ id: "v1", name: "Table", type: "table", filter: { op: "and", rules: [] }, sorts: [], hidden: [] }],
    },
  });
  const v = w.addRow(db, { title: "Venlafaxin", cells: { dose: 375 } });
  const b = w.addRow(db, { title: "Bisoprolol", cells: { dose: 10 } });
  return { w, db, v, b };
}

test("ticked: its own time beside it, and at once in today's entry of the log — the dose, the time; the other one 0 and no time", async () => {
  const { w, db, v, b } = await medis();
  const { dayOf } = await import("@/plugins/workspace/day-log");
  w.setCell(v, "took", true);
  const stamp = w.getDatabase(db)!.schema.properties.find((p) => p.stampOf === "took")!;
  assert.equal(stamp.includeTime, true);
  const at = String(w.getPage(v)!.props[stamp.id]);
  assert.match(at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  const logDb = (await import("@/lib/prefs")).getPref<Record<string, number>>("workspace.closeLogs", {})[db];
  const L = w.getDatabase(logDb)!;
  assert.equal(L.page.parentId, db, "the log is under the list");
  const col = (n: string) => L.schema.properties.find((p) => p.name === n)!.id;
  const [entry] = w.rawRows(logDb);
  assert.equal(entry.cells[L.schema.properties.find((p) => p.type === "date")!.id], dayOf(new Date()));
  assert.equal(entry.cells[col("Venlafaxin · Dosis (mg)")], 375);
  assert.equal(entry.cells[col("Bisoprolol · Dosis (mg)")], 0);
  assert.equal(entry.cells[col(`Venlafaxin · ${stamp.name}`)], at, "the time as it was ticked — a date with the time");
  assert.equal(L.schema.properties.find((p) => p.name === `Venlafaxin · ${stamp.name}`)!.includeTime, true);
  assert.equal(entry.cells[col(`Bisoprolol · ${stamp.name}`)], undefined, "not taken: no time");
  assert.equal(w.getPage(entry.id)!.locked, false, "today's entry stays open — it is closed when the day turns");
  // Unticked again: the time goes, from the list and from the day.
  w.setCell(v, "took", false);
  assert.equal(w.getPage(v)!.props[stamp.id], undefined);
  assert.equal(w.rawRows(logDb)[0].cells[col(`Venlafaxin · ${stamp.name}`)], undefined);
  assert.equal(w.rawRows(logDb).length, 1, "one entry a day");
  assert.equal(w.getPage(b)!.props.took, undefined, "the other untouched");
});

test("after 4:00 the list starts the day unticked; the day before stays in its log as it was", async () => {
  const { w, db, v } = await medis();
  const { startDayIfNew } = await import("@/plugins/workspace/day-log");
  w.setCell(v, "took", true);
  const logDb = (await import("@/lib/prefs")).getPref<Record<string, number>>("workspace.closeLogs", {})[db];
  const before = JSON.stringify(w.rawRows(logDb)[0].cells);
  assert.equal(startDayIfNew(db, new Date(Date.now() + 864e5)), true, "tomorrow: a new day");
  assert.equal(w.getPage(v)!.props.took, false, "unticked for the day");
  assert.equal(JSON.stringify(w.rawRows(logDb)[0].cells), before, "the day before as it was");
  assert.equal(w.getPage(w.rawRows(logDb)[0].id)!.locked, true, "the day before closed now");
  assert.equal(startDayIfNew(db, new Date(Date.now() + 864e5)), false, "once a day");
});

test("the day turns at 4:00; a time after midnight counts past 24", async () => {
  const { dayOf, hoursOfDay } = await import("@/plugins/workspace/day-log");
  assert.equal(dayOf(new Date(2026, 9, 24, 3, 30)), "2026-10-23", "0:00–4:00: the evening before");
  assert.equal(dayOf(new Date(2026, 9, 24, 4, 0)), "2026-10-24");
  assert.equal(hoursOfDay("2026-10-24T08:30"), 8.5);
  assert.equal(hoursOfDay("2026-10-25T00:30"), 24.5);
  assert.equal(hoursOfDay(""), null);
});

const logOf = async (db: number) => (await import("@/lib/prefs")).getPref<Record<string, number>>("workspace.closeLogs", {})[db];
const dayAfter = (day: string) => new Date(new Date(`${day}T12:00:00`).getTime() + 864e5).toLocaleDateString("sv-SE");

test("closed by hand on its day: the entry locked, the ticks off; what is ticked after it still counts for that day — added to it, never the next day's", async () => {
  const { w, db, v, b } = await medis();
  const { closeDay, dayOf, startDayIfNew } = await import("@/plugins/workspace/day-log");
  w.setCell(v, "took", true);
  const entry = closeDay(db);
  assert.equal(w.getPage(entry)!.locked, true);
  assert.equal(w.getPage(v)!.props.took, false, "the ticks off");
  assert.throws(() => closeDay(db), /closed already/);
  const L = await logOf(db);
  const date = w.getDatabase(L)!.schema.properties.find((p) => p.type === "date")!.id;
  const col = (n: string) => w.getDatabase(L)!.schema.properties.find((p) => p.name === n)!.id;
  const today = dayOf(new Date());
  const days = () => w.rawRows(L).map((r) => String(r.cells[date])).sort();
  // Ticked after closing, the same day: into the closed day, which keeps what it had.
  w.setCell(b, "took", true);
  assert.deepEqual(days(), [today], "no entry for the next day");
  const closed = w.rawRows(L).find((r) => r.id === entry)!;
  assert.equal(closed.cells[col("Venlafaxin · Dosis (mg)")], 375, "what was closed stays");
  assert.equal(closed.cells[col("Bisoprolol · Dosis (mg)")], 10, "the late tick added");
  assert.equal(w.getPage(entry)!.locked, true, "still closed");
  // The day turns as always: the late tick off, a new day.
  assert.equal(startDayIfNew(db, new Date(Date.now() + 864e5)), true);
  assert.equal(w.getPage(b)!.props.took, false);
});

test("the turn at 4:00 missed, closed by hand the next morning: the day the ticks were made is closed — not the new one", async () => {
  const { w, db, v, b } = await medis();
  const { closeDay, dayOf, startDayIfNew, writeDayLog } = await import("@/plugins/workspace/day-log");
  w.setCell(v, "took", true);
  const today = dayOf(new Date());
  // The next morning at 9:00 — nothing looked at the list since: its day has not turned.
  const morning = new Date(`${dayAfter(today)}T09:00:00`);
  const entry = closeDay(db, morning);
  const L = await logOf(db);
  const date = w.getDatabase(L)!.schema.properties.find((p) => p.type === "date")!.id;
  const col = (n: string) => w.getDatabase(L)!.schema.properties.find((p) => p.name === n)!.id;
  assert.equal(w.getPage(entry)!.props[date], today, "the day before is closed");
  assert.equal(w.getPage(entry)!.locked, true);
  assert.equal(w.getPage(entry)!.props[col("Venlafaxin · Dosis (mg)")], 375);
  assert.equal(w.getPage(v)!.props.took, false, "the ticks off");
  // The new day has begun with it: no second turn, and what is ticked now is that day's.
  assert.equal(startDayIfNew(db, morning), false);
  w.setCell(b, "took", true, { quiet: true });
  writeDayLog(db, morning);
  assert.deepEqual(w.rawRows(L).map((r) => String(r.cells[date])).sort(), [today, dayAfter(today)]);
  assert.equal(w.rawRows(L).find((r) => r.cells[date] === dayAfter(today))!.cells[col("Venlafaxin · Dosis (mg)")], 0, "the new day starts empty");
});

test("a close undone: the entry open again, the ticks and their times back — ticks count for today again", async () => {
  const { w, db, v } = await medis();
  const { closeDay, undoCloseDay } = await import("@/plugins/workspace/day-log");
  w.setCell(v, "took", true);
  const stamp = w.getDatabase(db)!.schema.properties.find((p) => p.stampOf === "took")!.id;
  const at = w.getPage(v)!.props[stamp];
  const entry = closeDay(db);
  undoCloseDay(db);
  assert.equal(w.getPage(entry)!.locked, false);
  assert.equal(w.getPage(v)!.props.took, true);
  assert.equal(w.getPage(v)!.props[stamp], at, "its time as it was");
  w.setCell(v, "took", false);
  assert.equal(w.rawRows(await logOf(db)).length, 1, "still today's entry");
  assert.throws(() => undoCloseDay(db), /Nothing to undo/);
});

test("a day's entry as a table like the list: a row per item, a column per field — the dose, the time it was taken", async () => {
  const { w, db, v, b } = await medis();
  const { dayEntryTable } = await import("@/plugins/workspace/day-log");
  w.setCell(v, "took", true);
  const L = await logOf(db);
  const [entry] = w.rawRows(L);
  const stamp = w.getDatabase(db)!.schema.properties.find((p) => p.stampOf === "took")!;
  const at = String(w.getPage(v)!.props[stamp.id]);
  const table = dayEntryTable(entry.id)!;
  assert.deepEqual(table.fields, ["Dosis (mg)", stamp.name]);
  assert.deepEqual(table.items.map((i) => i.name), ["Venlafaxin", "Bisoprolol"], "in the list's order");
  assert.deepEqual(table.items[0].cells, ["375", at.slice(11)], "the dose, the time of day");
  assert.deepEqual(table.items[1].cells, ["", ""], "not taken: empty");
  assert.equal(dayEntryTable(v), null, "a row of the list itself: no day's entry");
  void b;
});

test("an item renamed: its columns in the log are renamed with it — its days before kept in them, no new column", async () => {
  const { w, db, v } = await medis();
  w.setCell(v, "took", true);
  const L = await logOf(db);
  const count = () => w.getDatabase(L)!.schema.properties.length;
  const before = count();
  const col = (n: string) => w.getDatabase(L)!.schema.properties.find((p) => p.name === n);
  const [entry] = w.rawRows(L);
  w.updatePage(v, { title: "Venlafaxin retard" });
  w.setCell(v, "took", true);
  assert.equal(count(), before, "no new column");
  assert.equal(col("Venlafaxin · Dosis (mg)"), undefined, "the old name gone");
  const dose = col("Venlafaxin retard · Dosis (mg)")!;
  assert.ok(dose, "the column under the new name");
  assert.equal(w.getPage(entry.id)!.props[dose.id], 375, "the day before kept in it");
  const { dayEntryTable } = await import("@/plugins/workspace/day-log");
  assert.ok(dayEntryTable(entry.id)!.items.some((i) => i.name === "Venlafaxin retard" && i.cells[0] === "375"), "the day's table under the new name");
});

test("a list renamed: its log's name follows — one named by hand keeps its name", async () => {
  const { w, db, v } = await medis();
  w.setCell(v, "took", true);
  const L = await logOf(db);
  assert.equal(w.getPage(L)!.title, "Medis · History");
  w.updatePage(db, { title: "Medikamente" });
  assert.equal(w.getPage(L)!.title, "Medikamente · History", "the log follows");
  w.updatePage(L, { title: "Medis · Protokoll" });
  w.updatePage(db, { title: "Tabletten" });
  assert.equal(w.getPage(L)!.title, "Medis · Protokoll", "a name of its own stays");
});

test("a daily list is a setting of the database: on by itself with a timed tick, off when switched off — any list can be one", async () => {
  const { w, db } = await medis();
  const { isDayList } = await import("@/plugins/workspace/model");
  assert.equal(isDayList(w.getDatabase(db)!.schema), true, "a list from before with a timed tick");
  w.updateSchema(db, { ...w.getDatabase(db)!.schema, dayList: false });
  assert.equal(isDayList(w.getDatabase(db)!.schema), false, "switched off");
  // A list of your own: a tick and a field filled by itself, switched on by hand.
  const own = w.createPage({
    kind: "database",
    title: "Routine",
    schema: {
      titleName: "Name",
      dayList: true,
      properties: [
        { id: "done", name: "Erledigt", type: "checkbox" },
        { id: "at", name: "Wann", type: "date", includeTime: true, auto: { on: ["done"], formula: 'if(prop("Erledigt"), now(), "")' } },
      ],
      views: [{ id: "v1", name: "Table", type: "table", filter: { op: "and", rules: [] }, sorts: [], hidden: [] }],
    },
  });
  const r = w.addRow(own, { title: "Aufstehen" });
  w.setCell(r, "done", true);
  const L = w.getDatabase(await logOf(own))!;
  const [entry] = w.rawRows(L.page.id);
  assert.equal(entry.cells[L.schema.properties.find((p) => p.name === "Aufstehen · Wann")!.id], w.getPage(r)!.props.at);
  // Recording the time switched on later, on a list without the setting: the setting comes with it.
  const plain = w.createPage({ kind: "database", title: "Plain", schema: { titleName: "Name", properties: [{ id: "t", name: "Tick", type: "checkbox" }], views: [{ id: "v1", name: "Table", type: "table", filter: { op: "and", rules: [] }, sorts: [], hidden: [] }] } });
  const ps = w.getDatabase(plain)!.schema;
  w.updateSchema(plain, { ...ps, properties: ps.properties.map((p) => ({ ...p, stampTime: true })) });
  assert.equal(w.getDatabase(plain)!.schema.dayList, true);
});

test("a log from before with times as hours: its columns become dates with the time, the days' values with them (24.5: 0:30 the day after)", async () => {
  const { w, db, v } = await medis();
  const { setPref } = await import("@/lib/prefs");
  w.setCell(v, "took", false); // (the list's time field made, the log too)
  const stamp = w.getDatabase(db)!.schema.properties.find((p) => p.stampOf === "took")!;
  const name = `Venlafaxin · ${stamp.name}`;
  const old = w.createPage({
    kind: "database",
    parentId: db,
    title: "Medis · Verlauf",
    schema: { titleName: "Tag", properties: [{ id: "d", name: "Datum", type: "date" }, { id: "h", name, type: "number", format: "hours" }], views: [{ id: "v1", name: "Table", type: "table", filter: { op: "and", rules: [] }, sorts: [], hidden: [] }] },
  });
  const a = w.addRow(old, { title: "Fr", cells: { d: "2026-10-23", h: 24.5 } });
  const b = w.addRow(old, { title: "Do", cells: { d: "2026-10-22", h: 8.25 } });
  w.updatePage(a, { locked: true });
  setPref("workspace.closeLogs", { [db]: old });
  w.setCell(v, "took", true);
  const h = w.getDatabase(old)!.schema.properties.find((p) => p.id === "h")!;
  assert.equal(h.type, "date");
  assert.equal(h.includeTime, true);
  assert.equal(w.getPage(a)!.props.h, "2026-10-24T00:30");
  assert.equal(w.getPage(b)!.props.h, "2026-10-22T08:15");
  assert.equal(w.getPage(a)!.locked, true, "a closed day stays closed");
});
