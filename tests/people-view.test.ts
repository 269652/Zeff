import assert from "node:assert/strict";
import test from "node:test";
import { vnodeToString, type VNode } from "../src/plugins/workspace/card-template";
import { renderView } from "../src/plugins/workspace/view-template";
import type { Row } from "../src/plugins/workspace/model";
import { PEOPLE_VIEW } from "../src/plugins/people/view-template.meta";
import { peopleAppData } from "../src/plugins/people/view-data";
import type { PeopleOverview, PersonCardInfo } from "../src/plugins/people/tools";
import type { T } from "../src/lib/i18n/shared";

const t: T = (s, vars) => s.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars?.[k] ?? `{${k}}`));
const NOW = Date.parse("2026-10-22T10:00:00Z");
const ago = (days: number) => new Date(NOW - days * 864e5).toISOString();

const row = (id: number, title: string, personId: number, cells: Record<string, unknown> = {}): Row => ({ id, title, icon: "", cells: { srcref: `person:${personId}`, ...cells }, createdAt: "", updatedAt: "" });
const ROWS: Row[] = [
  row(11, "Anna Berg", 1, { peoplestar: true, peopletodos: "Call · Book" }),
  row(12, "Bert Klein", 2, { peoplenext: "2026-11-01", peoplenextkind: "Birthday" }),
  row(13, "Clara Dorn", 3),
  row(14, "Amt Köln", 4),
];
const card = (over: Partial<PersonCardInfo> = {}): PersonCardInfo => ({ lastContact: null, circle: "", circleSource: null as never, role: null, owed: [], away: null, email: "", chat: "", pay: null, birthdayIn: null, debt: null, ...over });

const overview = (over: Partial<PeopleOverview> = {}): PeopleOverview => ({
  count: 4,
  cards: {
    1: card({ circle: "family", lastContact: { at: ago(70), channel: "WhatsApp" }, chat: "Anna Berg" }),
    2: card({ circle: "friends", lastContact: { at: ago(3), channel: "Mail" }, owed: [{ id: 5, direction: "mine", text: "Book back", due: "" }] }),
    3: card({ circle: "work", lastContact: { at: ago(20), channel: "Teams" } }),
    4: card(),
  },
  upcoming: [{ key: "9", personId: 2, title: "Bert Klein's birthday", when: "in 10 days", soon: false }, { key: "8", personId: 99, title: "Someone gone", when: "tomorrow", soon: true }],
  identities: [{ id: 1, text: "Merge A into Anna Berg", evidence: "same mail", confidence: 0.82 }],
  dates: [{ id: 3, personId: 3, person: "Clara Dorn", text: "Birthday: 3 May", source: "a mail" }],
  claims: [{ id: 4, personId: 1, person: "Anna Berg", kind: "fact", text: "works at X", evidence: "I'm at X now", confidence: 0.95 }],
  links: [{ id: 6, personId: 3, person: "Clara Dorn", text: "works-with Bert Klein", evidence: "" }],
  stale: [],
  owed: [{ id: 5, personId: 2, person: "Bert Klein", text: "Book back", direction: "mine", due: "2026-11-01" }],
  suggestions: { persons: [{ id: 70, name: "Dora Eck", aliases: ["Dora"], pages: 4 }], chats: [{ name: "Eva", messages: 12 }], error: null },
  progress: { dates: null, compile: null },
  nudges: [{ personId: 1, name: "Anna Berg", at: ago(70), channel: "WhatsApp", days: 70 }],
  meetings: [{ personId: 3, name: "Clara Dorn", eventId: 7, title: "Weekly", start: "2026-10-22T14:00", lastMet: ago(7), since: [{ at: ago(2), text: "Sent the draft" }], owed: [{ direction: "theirs", text: "The slides", due: "" }], cases: [{ label: "AZ 1", title: "Rent", open: 0, nextDue: null }] }],
  confident: 1,
  settings: { weeks: 6, myName: "Me Myself" },
  ...over,
});

const find = (nodes: VNode[], tag: string): Extract<VNode, object>[] => nodes.flatMap((n) => (typeof n === "string" ? [] : [...(n.t === tag ? [n] : []), ...find(n.c, tag)]));
const parts = (nodes: VNode[], name: string) => find(nodes, "part").filter((p) => p.a.name === name);
const data = (o: PeopleOverview | null, state: Record<string, string>, rows = ROWS) => (o ? peopleAppData(o, rows, { t, state, now: NOW, locale: "en-GB" }) : { loading: true, error: null });
const draw = (o: PeopleOverview | null, state: Record<string, string> = {}, rows = ROWS) => {
  const tpl = PEOPLE_VIEW.defaultTemplate(t);
  return renderView(tpl, { rows, props: [], titleName: "Name", state, app: data(o, state, rows), db: { id: 1, title: "People" }, locale: "en-GB" }, { parts: PEOPLE_VIEW.parts, actions: PEOPLE_VIEW.actions });
};

test("the people overview's default template draws without an error — loading, empty, full, every filter, sort and the form open", () => {
  const cases: [PeopleOverview | null, Record<string, string>, Row[]?][] = [
    [null, {}],
    [overview({ count: 0, cards: {}, upcoming: [], identities: [], dates: [], claims: [], links: [], owed: [], nudges: [], meetings: [], confident: 0, suggestions: { persons: [], chats: [], error: null } }), {}, []],
    [overview(), {}],
    [overview(), { circle: "family", only: "starred", sort: "quiet" }],
    [overview(), { circle: "none", only: "todos", sort: "recent" }],
    [overview(), { only: "owed", sort: "next" }],
    [overview(), { only: "soon", sort: "todos" }],
    [overview(), { only: "quiet", adding: "true", busy: "import" }],
    [overview({ progress: { dates: { done: 2, total: 9, found: 1 }, compile: { done: 1, total: 4, current: "Anna" } }, suggestions: { persons: [], chats: [], error: "down" } }), {}],
  ];
  for (const [o, state, rows] of cases) assert.deepEqual(draw(o, state, rows).errors, [], JSON.stringify(state));
});

test("the state's defaults: all circles, no filter, by name, the messages since last", () => {
  const r = draw(overview());
  assert.equal(r.state.circle, "all");
  assert.equal(r.state.only, "");
  assert.equal(r.state.sort, "name");
  assert.equal(r.state.days, "0");
});

test("the circles as a dropdown with their counts (those with nobody left out), a card per person — the starred first", () => {
  const r = draw(overview());
  const tabs = find(r.nodes, "select").find((x) => x.a.bind === "circle")!;
  assert.deepEqual(JSON.parse(tabs.a.options), [["all", "All 4"], ["family", "Family 1"], ["friends", "Friends 1"], ["work", "Work 1"], ["none", "No circle 1"]]);
  assert.deepEqual(parts(r.nodes, "people.card").map((p) => p.a.row), ["11", "14", "12", "13"]);
  assert.match(vnodeToString(r.nodes), /4 people/);
  assert.deepEqual(find(r.nodes, "select").map((s) => s.a.bind), ["circle", "sort"], "the circle and the order — the side is a tab of its own");
});

test("filters and sorts as before: a circle, only some, the longest quiet first; the count says how many of all", () => {
  const ids = (state: Record<string, string>) => parts(draw(overview(), state).nodes, "people.card").map((p) => Number(p.a.row));
  assert.deepEqual(ids({ circle: "family" }), [11]);
  assert.deepEqual(ids({ circle: "none" }), [14]);
  assert.deepEqual(ids({ only: "todos" }), [11]);
  assert.deepEqual(ids({ only: "owed" }), [12]);
  assert.deepEqual(ids({ only: "soon" }), [12]);
  assert.deepEqual(ids({ only: "quiet" }), [11], "family, 10 weeks quiet");
  assert.deepEqual(ids({ sort: "quiet" }), [11, 13, 12, 14], "never in touch at the end");
  assert.deepEqual(ids({ sort: "recent" }), [12, 13, 11, 14]);
  assert.deepEqual(ids({ sort: "next" }), [12, 14, 11, 13]);
  assert.match(vnodeToString(draw(overview(), { only: "todos" }).nodes), /1 of 4/);
  const none = draw(overview(), { circle: "work", only: "todos" });
  assert.match(vnodeToString(none.nodes), /No one matches\./);
});

test("a filter is a button that sets the state, pressed when on — and off again with a second click", () => {
  const r = draw(overview(), { only: "todos" });
  const btn = find(r.nodes, "button").filter((b) => b.a.action === "state" && b.a.state === "only");
  assert.equal(btn.length, 5);
  const todos = btn.find((b) => b.a.label === "With todos")!;
  assert.equal(todos.a.value, "", "a second click: off");
  assert.equal(todos.a.variant, "primary");
  assert.equal(btn.find((b) => b.a.label === "★ Starred")!.a.value, "starred");
});

test("New (the toolbar's) opens the form (a part); the other tab: appointments, nudges, coming up, to check, suggestions, tools", () => {
  assert.equal(parts(draw(overview()).nodes, "people.add").length, 0);
  assert.equal(find(draw(overview()).nodes, "part").filter((x) => x.a.name === "people.add").length, 0, "closed until New");
  assert.equal(parts(draw(overview(), { adding: "true" }).nodes, "people.add").length, 1);
  assert.equal(parts(draw(overview(), { adding: "true" }).nodes, "people.card").length, 4, "the gallery the whole width — the rest a tab of its own");
  const r = draw(overview(), { adding: "true", tab: "more" });
  assert.equal(parts(r.nodes, "people.card").length, 0);
  const s = vnodeToString(r.nodes);
  for (const x of ["Appointments in the next 24 hours", "Get in touch again?", "after 6 weeks", "Coming up", "To check", "5 in the review queue", "Suggestions", "Tools and settings"]) assert.ok(s.includes(x), x);
  // A name opens their row — one without a row stays a name.
  const opens = find(r.nodes, "button").filter((b) => b.a.action === "open");
  assert.ok(opens.some((b) => b.a.row === "12" && b.a.label === "Bert Klein"));
  assert.match(s, /<b>Someone gone<\/b>/);
  // Write in the chat; later.
  assert.ok(find(r.nodes, "button").some((b) => b.a.action === "url" && b.a.href === "/mail?q=Anna%20Berg"));
  assert.deepEqual(parts(r.nodes, "people.tool").filter((p) => p.a.tool === "snooze").map((p) => p.a.person), ["1"]);
  assert.ok(find(r.nodes, "button").some((b) => b.a.action === "url" && b.a.href === "/review"));
});

test("an appointment folds its brief: since you last met, what is open, the cases", () => {
  const r = draw(overview(), { tab: "more" });
  const meeting = find(r.nodes, "section").find((x) => x.a.title?.includes("Clara Dorn"))!;
  assert.ok(meeting.a.collapsible === "true" && meeting.a.title.includes("Weekly"));
  const s = vnodeToString(meeting.c);
  assert.match(s, /Last met 7 days ago/);
  assert.match(s, /Sent the draft/);
  assert.match(s, /The slides/);
  assert.match(s, /Rent/);
  assert.match(s, /open €0.00/, "a case with nothing open still says so");
});

test("to check: a group per kind (open when it is the only one), each thing with a yes/no part", () => {
  const r = draw(overview(), { tab: "more" });
  const groups = find(r.nodes, "section").filter((x) => x.a.collapsible === "true" && /^(Same person\?|Open commitments|What the AI read|Still true\?|Dates found)/.test(x.a.title));
  assert.deepEqual(groups.map((g) => g.a.title), ["Same person? · 1", "Open commitments · 1", "What the AI read · 2", "Dates found · 1"]);
  assert.ok(groups.every((g) => g.a.open === "false"));
  assert.deepEqual(parts(r.nodes, "people.verdict").map((p) => `${p.a.on}:${p.a.item}`), ["identity:1", "commitment:5", "claim:4", "link:6", "date:3"]);
  assert.match(vnodeToString(groups[2].c), /“I'm at X now” · 95%/);
  assert.equal(parts(r.nodes, "people.tool").filter((p) => p.a.tool === "acceptConfident").length, 1);
  const one = draw(overview({ identities: [], claims: [], links: [], owed: [] }), { tab: "more" });
  assert.deepEqual(find(one.nodes, "section").filter((x) => x.a.title?.startsWith("Dates found")).map((g) => g.a.open), ["true"]);
});

test("suggestions to take over, the tools (what runs shows how far), the settings", () => {
  const r = draw(overview(), { tab: "more" });
  const tools = parts(r.nodes, "people.tool").map((p) => p.a.tool);
  for (const x of ["import", "findAll", "normalize", "extract", "classify", "linkJira", "compile"]) assert.ok(tools.includes(x), x);
  assert.deepEqual(parts(r.nodes, "people.tool").filter((p) => p.a.tool === "add").map((p) => p.a.entity || p.a.whatsapp), ["70", "Eva"]);
  assert.equal(parts(r.nodes, "people.settings").length, 1);
  assert.equal(find(r.nodes, "section").find((x) => x.a.title === "Tools and settings")!.a.open, "false");
  const busy = draw(overview({ progress: { dates: { done: 2, total: 9, found: 1 }, compile: { done: 1, total: 4, current: "Anna" } } }), { tab: "more" });
  const s = vnodeToString(busy.nodes);
  assert.match(s, /Searching dates… 2 of 9 · 1 found/);
  assert.match(s, /Compiling … 1 of 4 · Anna/);
  assert.ok(!parts(busy.nodes, "people.tool").some((p) => p.a.tool === "findAll" || p.a.tool === "compile"));
  assert.equal(find(busy.nodes, "section").find((x) => x.a.title === "Tools and settings")!.a.open, "true", "open while something runs");
  const one = draw(overview({ count: 1 }), { tab: "more" });
  assert.ok(!parts(one.nodes, "people.tool").some((p) => p.a.tool === "normalize"), "matching names takes two");
});
