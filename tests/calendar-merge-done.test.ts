import assert from "node:assert/strict";
import test from "node:test";
import { mergeDone, DONE_CALENDAR, type Item } from "../src/plugins/calendar/view-shared";

const cal = (key: string) => ({ key }) as Item["calendar"];
const item = (id: string, start: string, end: string, key = "outlook", extra: Partial<Item> = {}): Item => ({ id, title: id, start, end, allDay: false, color: key === DONE_CALENDAR ? "#10b981" : "#3b82f6", editable: false, calendar: cal(key), ...extra });

test("a Done item that covers the same time as a meeting is merged into it", () => {
  const out = mergeDone([item("meet", "2026-10-14T09:30", "2026-10-14T17:00"), item("done", "2026-10-14T09:30", "2026-10-14T17:00", DONE_CALENDAR)]);
  assert.deepEqual(out.map((i) => i.id), ["meet"]);
  assert.equal(out[0].merged?.id, "done");
});

test("mostly the same time is enough; a different time stays apart", () => {
  const near = mergeDone([item("meet", "2026-10-14T10:00", "2026-10-14T11:00"), item("done", "2026-10-14T10:10", "2026-10-14T11:05", DONE_CALENDAR)]);
  assert.deepEqual(near.map((i) => i.id), ["meet"]);
  const apart = mergeDone([item("meet", "2026-10-14T10:00", "2026-10-14T11:00"), item("done", "2026-10-14T10:45", "2026-10-14T12:00", DONE_CALENDAR)]);
  assert.deepEqual(apart.map((i) => i.id).sort(), ["done", "meet"]);
  assert.ok(apart.every((i) => !i.merged));
});

test("one Done item per meeting (the closest), a Done item goes to one meeting; proposals and all-day items don't take it", () => {
  const out = mergeDone([
    item("m1", "2026-10-14T10:00", "2026-10-14T11:00"),
    item("m2", "2026-10-14T10:00", "2026-10-14T10:50"),
    item("d1", "2026-10-14T10:00", "2026-10-14T10:50", DONE_CALENDAR),
    item("d2", "2026-10-14T10:00", "2026-10-14T11:00", DONE_CALENDAR),
  ]);
  assert.deepEqual(out.map((i) => [i.id, i.merged?.id]).sort(), [["m1", "d2"], ["m2", "d1"]]);
  const none = mergeDone([item("p", "2026-10-14T10:00", "2026-10-14T11:00", "outlook", { proposed: {} as Item["proposed"] }), item("d", "2026-10-14T10:00", "2026-10-14T11:00", DONE_CALENDAR)]);
  assert.equal(none.length, 2);
});
