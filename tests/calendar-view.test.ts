import assert from "node:assert/strict";
import test from "node:test";
import { vnodeToString, type VNode } from "../src/plugins/workspace/card-template";
import { renderView, viewDefaults } from "../src/plugins/workspace/view-template";
import { CALENDAR_VIEW } from "../src/plugins/calendar/view-template.meta";
import { calendarAppData } from "../src/plugins/calendar/app-data";
import { calendarItems } from "../src/plugins/calendar/view-shared";
import type { CalendarData } from "../src/plugins/calendar/view-data";
import type { CalendarEventView, CalendarView, ProposedEvent } from "../src/lib/calendar/ir-shared";
import type { T } from "../src/lib/i18n/shared";

const t: T = (s, vars) => s.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars?.[k] ?? `{${k}}`));
const cal = (id: number, source: CalendarView["source"], name: string, over: Partial<CalendarView> = {}): CalendarView => ({ id, key: `${source}:${id}`, source, name, color: "#55B080", visible: true, busy: true, book: false, todos: false, ...over });
const event = (id: number, calendarId: number, title: string, start: string, end: string): CalendarEventView =>
  ({ id, calendarId, title, start, end, allDay: false, location: "", description: "", recurrence: null, cancelled: false }) as unknown as CalendarEventView;
const proposal = (todoId: number, title: string, start: string, end: string): ProposedEvent =>
  ({ todoId, todoRef: `T-${todoId}`, todoText: title, index: 0, href: "", type: "calendar-entry", title, start, end, target: "Zeff" }) as ProposedEvent;

const data = (view: CalendarData["view"], day: string, over: Partial<CalendarData> = {}): CalendarData => ({
  view,
  day,
  calendars: [cal(1, "zeff", "Privat"), cal(2, "google", "Ich"), cal(3, "google", "Geburtstage", { busy: false, visible: false }), cal(4, "outlook", "Arbeit", { color: "#3366ff" })],
  events: [event(1, 1, "Geschenk besorgen", "2026-10-21T18:00", "2026-10-21T19:00"), event(2, 2, "Tatort", "2026-10-25T20:00", "2026-10-25T22:00"), event(3, 3, "Oma", "2026-10-22T00:00", "2026-10-22T23:59"), event(4, 4, "Daily", "2026-10-22T09:30", "2026-10-22T09:45")],
  proposed: [proposal(12, "Rückruf Steuerberater", "2026-10-23T10:00", "2026-10-23T10:30"), proposal(13, "Angebot schreiben", "2026-10-24T14:00", "2026-10-24T15:00")],
  now: "2026-10-22T11:05",
  canSync: true,
  ...over,
});

const find = (nodes: VNode[], tag: string): Extract<VNode, object>[] => nodes.flatMap((n) => (typeof n === "string" ? [] : [...(n.t === tag ? [n] : []), ...find(n.c, tag)]));
const template = CALENDAR_VIEW.defaultTemplate(t);
const draw = (state: Record<string, string>, d: CalendarData | null, error = "") => {
  const s = { ...viewDefaults(template), ...state };
  return renderView(template, { rows: [], props: [], titleName: "Name", state: s, app: calendarAppData(d, { state: s, t, today: "2026-10-22", error }), db: { id: 7, title: "Calendar" }, locale: "en-GB" }, { parts: CALENDAR_VIEW.parts, actions: CALENDAR_VIEW.actions });
};

test("the calendar's default template draws without an error — every view, loading, an error, without Google", () => {
  for (const view of ["day", "week", "month", "agenda"] as const) assert.deepEqual(draw({ view, day: "2026-10-22" }, data(view, "2026-10-22")).errors, [], view);
  assert.deepEqual(draw({}, null).errors, [], "loading");
  assert.deepEqual(draw({}, null, "The calendar is not installed").errors, [], "an error");
  assert.deepEqual(draw({}, data("week", "2026-10-22", { canSync: false, proposed: [] })).errors, [], "no sync, nothing proposed");
});

test("it starts on this week (the day empty: today); the address' view and day are taken as they are", () => {
  assert.equal(viewDefaults(template).view, "week");
  assert.equal(viewDefaults(template).day, "");
  assert.equal(viewDefaults(template).proposed, "true");
  const app = calendarAppData(null, { state: { view: "week", day: "" }, t, today: "2026-10-22" });
  assert.equal(app.view, "week");
  assert.equal(app.day, "2026-10-22");
  assert.equal(app.loading, true);
  const odd = calendarAppData(null, { state: { view: "year", day: "tomorrow" }, t, today: "2026-10-22" });
  assert.equal(odd.view, "week", "an unknown view: the week");
  assert.equal(odd.day, "2026-10-22", "not a day: today");
});

test("the toolbar is the language's: Today, back and forth by the view's step, the range as the title, the views as tabs bound to the state", () => {
  const r = draw({ view: "week", day: "2026-10-22" }, data("week", "2026-10-22"));
  const tabs = find(r.nodes, "tabs")[0];
  assert.equal(tabs.a.bind, "view");
  assert.equal(tabs.a.current, "week");
  assert.deepEqual(JSON.parse(tabs.a.options).map((o: string[]) => o[0]), ["day", "week", "month", "agenda"]);
  const days = find(r.nodes, "button").filter((b) => b.a.action === "state" && b.a.state === "day");
  assert.deepEqual(days.map((b) => b.a.value), ["2026-10-22", "2026-10-15", "2026-10-29"], "today, a week back, a week on");
  assert.match(vnodeToString(find(r.nodes, "heading")[0]), /19 – 25 Oct 2026/);
  const month = draw({ view: "month", day: "2026-10-22" }, data("month", "2026-10-22"));
  assert.deepEqual(find(month.nodes, "button").filter((b) => b.a.state === "day").map((b) => b.a.value), ["2026-10-22", "2026-09-01", "2026-11-01"]);
  assert.match(vnodeToString(find(month.nodes, "heading")[0]), /October 2026/);
  assert.deepEqual(find(r.nodes, "button").filter((b) => b.a.action === "calendar.sync").length, 1, "Sync with Google");
  assert.deepEqual(find(draw({}, data("week", "2026-10-22", { canSync: false })).nodes, "button").filter((b) => b.a.action === "calendar.sync").length, 0);
  assert.doesNotMatch(vnodeToString(r.nodes), /Saving…/);
  assert.match(vnodeToString(draw({ saving: "true" }, data("week", "2026-10-22")).nodes), /Saving…/, "while a change is saved");
});

test("the sidebar: New, the month to pick from, the calendars by source with their switches, the todos' proposals, the shortcuts; the grid beside it", () => {
  const r = draw({ view: "week", day: "2026-10-22" }, data("week", "2026-10-22"));
  const main = find(r.nodes, "row").find((x) => find(x.c, "part").some((p) => p.a.name === "calendar.grid"))!;
  assert.ok(main, "the sidebar and the grid in a row");
  const [side, grid] = main.c.filter((c): c is Extract<VNode, object> => typeof c !== "string");
  assert.equal(side.t, "col");
  assert.equal(grid.a.name, "calendar.grid", "the grid itself a part, beside the sidebar");
  assert.ok(find(side.c, "button").some((b) => b.a.action === "calendar.new"), "New event");
  assert.ok(find(side.c, "part").some((p) => p.a.name === "calendar.minimonth"));
  const text = vnodeToString(side);
  for (const w of ["MY CALENDARS", "GOOGLE CALENDAR", "OUTLOOK", "TODOS", "Keyboard shortcuts", "Previous / next"]) assert.ok(text.includes(w), w);
  const toggles = find(side.c, "part").filter((p) => p.a.name === "calendar.toggle");
  assert.deepEqual(toggles.map((p) => p.a.calendar), ["1", "2", "3", "4", "proposed"]);
  assert.deepEqual(toggles.map((p) => p.a.label), ["Privat", "Ich", "Geburtstage", "Arbeit", "Proposed by todos"]);
  const rowOf = (p: Extract<VNode, object>) => vnodeToString(find(side.c, "row").find((x) => x.c.includes(p))!);
  assert.match(rowOf(toggles[2]), /free/, "a calendar that doesn't block time");
  assert.doesNotMatch(rowOf(toggles[1]), /free/);
  assert.match(rowOf(toggles[4]), /2/, "how many are proposed");
  assert.ok(find(side.c, "button").some((b) => b.a.action === "url" && b.a.href === "/settings/calendar"));
});

test("the items shown: the calendars switched on (the view's own switch over the stored one), the proposals when wanted", () => {
  const d = data("week", "2026-10-22");
  const titles = (shown: (c: CalendarView) => boolean, proposed: boolean) => calendarItems(d.events, d.proposed, d.calendars, shown, proposed).map((i) => i.title);
  assert.deepEqual(titles((c) => c.visible, true), ["Geschenk besorgen", "Tatort", "Daily", "Rückruf Steuerberater", "Angebot schreiben"]);
  assert.deepEqual(titles((c) => c.id === 3, false), ["Oma"]);
  const items = calendarItems(d.events, d.proposed, d.calendars, () => true, true);
  assert.equal(items.find((i) => i.title === "Daily")!.color, "#3366ff", "a calendar's colour");
  assert.equal(items.find((i) => i.title === "Daily")!.editable, false, "Outlook's opens in Outlook");
  assert.equal(items.find((i) => i.title === "Geschenk besorgen")!.editable, true);
  assert.equal(items.find((i) => i.title === "Angebot schreiben")!.editable, true, "a proposal of a calendar action can be dragged");
  assert.equal(calendarItems(d.events, d.proposed, d.calendars, () => true, true, { e1: { start: "2026-10-21T19:00", end: "2026-10-21T20:00" } })[0].start, "2026-10-21T19:00", "moved here, until the server has it");
});

test("on a phone the calendar leaves out what the toolbar does already (its + makes an appointment, the header syncs): phone=hide", () => {
  const r = draw({ view: "week", day: "2026-10-22" }, data("week", "2026-10-22"));
  const buttons = find(r.nodes as VNode[], "button");
  assert.equal(buttons.find((b) => b.a.action === "calendar.new")?.a.phone, "hide");
  assert.equal(buttons.find((b) => b.a.action === "calendar.sync")?.a.phone, "hide");
  const headings = find(r.nodes as VNode[], "heading");
  assert.deepEqual(headings.map((h) => [h.a.level, h.a.phone]), [["2", "hide"], ["3", "only"]], "a smaller date heading on a phone");
});
