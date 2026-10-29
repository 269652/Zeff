import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

// A shadow calendar: one of Zeff's own embedded in a page (a day, a week, a month planned there) — its appointments are
// suggestions in the main calendar (dashed, with the proposals), accepted into your own calendar or dismissed.
setupTempData();

test("a shadow calendar: blocks no time, its appointments are suggestions in the main calendar and plain in its own block; accepted, one is in your own calendar", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("calendar", true);
  const ir = await import("@/lib/calendar/ir");
  const own = ir.zeffCalendar();
  const shadow = ir.createShadowCalendar("Urlaubsplan");
  assert.deepEqual([shadow.shadow, shadow.busy, shadow.book, shadow.todos, shadow.source], [true, false, false, false, "zeff"]);
  assert.equal(ir.zeffCalendar().id, own.id, "never the shadow calendar where something is entered for real");
  const e = ir.addEvent(shadow.id, { title: "Wandern", start: "2026-11-03T09:00", end: "2026-11-03T12:00" });
  ir.addEvent(own.id, { title: "Zahnarzt", start: "2026-11-03T14:00", end: "2026-11-03T15:00" });

  const { calendarItems } = await import("@/plugins/calendar/view-shared");
  const calendars = ir.listCalendars();
  const events = ir.eventsBetween("2026-11-03T00:00", "2026-11-03T23:59").map(({ calendar: _c, ...x }) => x);
  const all = () => true;
  const titles = (items: { title: string; shadow?: boolean }[]) => items.map((i) => `${i.title}${i.shadow ? " (suggestion)" : ""}`).sort();
  assert.deepEqual(titles(calendarItems(events, [], calendars, all, true)), ["Wandern (suggestion)", "Zahnarzt"], "the main calendar: a suggestion");
  assert.deepEqual(titles(calendarItems(events, [], calendars, all, false)), ["Zahnarzt"], "proposals switched off: not shown");
  assert.deepEqual(titles(calendarItems(events, [], calendars, (c) => c.id === shadow.id, false, {}, false)), ["Wandern"], "its own block: plain");
  // Free times: it blocks nothing.
  assert.deepEqual(ir.busyBetween(new Date("2026-11-03T00:00"), new Date("2026-11-03T23:59")).map((b) => b.title), ["Zahnarzt"]);

  const { acceptShadowEventAction } = await import("@/plugins/calendar/server-actions");
  const r = await acceptShadowEventAction(e.id);
  assert.equal(r?.ok, true, String(r && "error" in r ? r.error : ""));
  assert.equal(ir.eventById(e.id), null, "out of the shadow calendar");
  const moved = ir.eventsBetween("2026-11-03T00:00", "2026-11-03T23:59").find((x) => x.title === "Wandern")!;
  assert.deepEqual([moved.calendarId, moved.start, moved.end], [own.id, "2026-11-03T09:00", "2026-11-03T12:00"]);
  assert.equal((await acceptShadowEventAction(moved.id))?.ok, false, "a real one isn't a suggestion");

  const { docToMarkdown, markdownToDoc } = await import("@/plugins/workspace/doc");
  const doc = markdownToDoc(`Plan\n\n:::calendar ${shadow.id} month\n`);
  assert.match(JSON.stringify(doc), new RegExp(`"type":"calendarEmbed","attrs":\\{"calendarId":${shadow.id},"view":"month"`));
  assert.match(docToMarkdown(doc), new RegExp(`:::calendar ${shadow.id} month`));
});

test("the main calendar shows only the shadow calendars a page still embeds (a plan whose block is gone stays out — kept for Ctrl+Z)", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("calendar", true);
  setInstalled("workspace", true);
  const ir = await import("@/lib/calendar/ir");
  const used = ir.createShadowCalendar("Embedded plan");
  const orphan = ir.createShadowCalendar("Left over");
  ir.addEvent(used.id, { title: "Plan A", start: "2027-02-03", end: "2027-02-04", allDay: true });
  ir.addEvent(orphan.id, { title: "Plan B", start: "2027-02-03", end: "2027-02-04", allDay: true });
  const w = await import("@/plugins/workspace/store");
  w.createPage({ title: "Plan", content: { type: "doc", content: [{ type: "calendarEmbed", attrs: { calendarId: used.id, view: "week", day: "", also: "" } }] } });
  const { calendarViewData } = await import("@/plugins/calendar/view-data");
  const d = await calendarViewData("week", "2027-02-03");
  assert.equal(d.calendars.some((c) => c.id === used.id), true);
  assert.equal(d.calendars.some((c) => c.id === orphan.id), false, "not embedded anywhere: out of the main calendar");
  assert.deepEqual(d.events.filter((e) => e.title.startsWith("Plan")).map((e) => e.title), ["Plan A"]);
  const kept = await calendarViewData("week", "2027-02-03", [orphan.id]);
  assert.equal(kept.calendars.some((c) => c.id === orphan.id), true, "the block showing it (just made, not saved yet) still gets it");
  assert.equal(ir.listCalendars().some((c) => c.id === orphan.id), true, "not deleted (Ctrl+Z brings its block back)");
});
