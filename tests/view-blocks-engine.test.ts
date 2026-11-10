import assert from "node:assert/strict";
import test from "node:test";
import { vnodeToString, type VNode } from "../src/plugins/workspace/card-template";
import type { Property, Row } from "../src/plugins/workspace/model";
import { normalizeBlock, blockSignature, type BlockDef } from "../src/plugins/workspace/blocks";
import { blockReference, renderView, viewReference, type ViewData } from "../src/plugins/workspace/view-template";

/** The view language grown: blocks of your own (<use>, <slot>, state per use, @flows), names (<let>, <switch>), more blocks and filters. */

const props: Property[] = [
  { id: "st", name: "Status", type: "status", options: [{ id: "o", name: "Offen", color: "blue" }, { id: "w", name: "Wartet", color: "yellow" }, { id: "d", name: "Erledigt", color: "green" }] },
  { id: "own", name: "Owner", type: "select", options: [{ id: "a", name: "Anna" }, { id: "b", name: "Ben" }] },
  { id: "amt", name: "Amount", type: "number", format: "euro" },
  { id: "due", name: "Due", type: "date" },
  { id: "stars", name: "Stars", type: "number" },
] as Property[];
const row = (id: number, title: string, st: string, own: string, amt: number, due?: string, stars?: number): Row =>
  ({ id, title, icon: "", cells: { st, own, amt, ...(due ? { due } : {}), ...(stars !== undefined ? { stars } : {}) }, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" }) as Row;
const rows = [row(1, "Alpha", "o", "a", 100, "2026-11-03", 4), row(2, "Beta", "w", "b", 250, "2026-11-03"), row(3, "Gamma", "d", "a", 50, "2026-10-30"), row(4, "Delta", "o", "b", 75, "2026-11-20")];
const data = (over: Partial<ViewData> = {}): ViewData => ({ rows, props, titleName: "Deal", state: {}, app: {}, db: { id: 7, title: "Deals" }, now: new Date("2026-11-10T10:00:00"), locale: "de-DE", ...over });
const find = (nodes: VNode[], t: string): Extract<VNode, object>[] => nodes.flatMap((n) => (typeof n === "string" ? [] : [...(n.t === t ? [n] : []), ...find(n.c, t)]));

const card = normalizeBlock({
  name: "crm.deal-card",
  description: "A deal",
  params: [
    { name: "amount", type: "text", default: "Amount" },
    { name: "tone", type: "text", options: ["plain", "good"], default: "plain" },
  ],
  template: '<row><b>{{ title }}</b>{{ props.amount | field | euro(0) }}<text tone="{{ props.tone }}">{{ Status }}</text></row><slot/><slot name="aside"/>',
});
const counter = normalizeBlock({
  name: "counter",
  description: "Rows with a filter of its own",
  params: [{ name: "items", type: "list", required: true }, { name: "label", type: "text", default: "Rows" }],
  template: '<state name="q" value=""/><search bind="q"/><tile label="{{ props.label }}" value="{{ props.items | search(state.q) | count }}"/><list source="props.items" select=true>{{ title }}</list><selected empty="none">{{ title }}</selected>',
});
const finder = normalizeBlock({
  name: "web.finder",
  description: "Finds things through its flow",
  params: [],
  template: '<state name="q" value="x"/><data name="hits" flow="@search" with="q={{ state.q }}"/><button run="@search" into="hits" then="q=" label="Go"/>{{ data.hits_status }}',
});
const blocks: BlockDef[] = [card, counter, finder];

test("a block is a template with parameters: props, a field named by a parameter, slots filled where it is used", () => {
  const r = renderView('<list source="rows | limit(1)"><use block="crm.deal-card" tone="good"><button action="open" label="Open"/><fill slot="aside"><small>side</small></fill></use></list>', data(), { blocks });
  assert.deepEqual(r.errors, []);
  const s = vnodeToString(r.nodes);
  assert.match(s, /Alpha/);
  assert.match(s, /100\s€/, "props.amount | field: the row's Amount");
  assert.equal(find(r.nodes, "text")[0].a.tone, "good");
  assert.equal(find(r.nodes, "button")[0].a.row, "1", "the slot is drawn with the names where it is used: the button acts on the row");
  assert.match(s, /side/, "a named slot");
});

test("each use keeps its own state; a list parameter is a collection evaluated where it is used", () => {
  const src = '<use block="counter" items="rows | where(\'Status\', \'Offen\')" label="Open"/><use block="counter" items="rows"/>';
  const r = renderView(src, data({ state: { _counter0_q: "alp" } }), { blocks });
  assert.deepEqual(r.errors, []);
  const tiles = find(r.nodes, "tile");
  assert.deepEqual(tiles.map((t) => [t.a.label, t.a.value]), [["Open", "1"], ["Rows", "4"]], "the first use's search narrows only its own rows");
  const searches = find(r.nodes, "search");
  assert.deepEqual(searches.map((s) => s.a.bind), ["_counter0_q", "_counter1_q"]);
  assert.equal(r.state._counter1_q, "", "its <state> default, under its own name");
  const lists = find(r.nodes, "list");
  assert.equal(lists[0].a.selkey, "_counter0_selected", "picking a row is its own too");
  const picked = renderView(src, data({ state: { _counter1_selected: "3" } }), { blocks });
  assert.deepEqual(find(picked.nodes, "selected").map((x) => x.a.row), ["3"]);
  assert.match(vnodeToString(picked.nodes), /none/, "the other use has nothing picked");
});

test("a block's own flows: @name is block.<name>.<flow>; its data and into= are its own", () => {
  const r = renderView('<use block="web.finder"/>', data({ data: { _web_finder0_hits_status: "ok" } }), { blocks });
  assert.deepEqual(r.errors, []);
  assert.equal(find(r.nodes, "data")[0].a.flow, "block.web.finder.search");
  assert.equal(find(r.nodes, "data")[0].a.name, "_web_finder0_hits");
  const b = find(r.nodes, "button")[0];
  assert.deepEqual([b.a.run, b.a.into, b.a.then], ["block.web.finder.search", "_web_finder0_hits", "_web_finder0_q="]);
  assert.match(vnodeToString(r.nodes), /ok/, "data.hits_status reads its own");
});

test("mistakes in using a block are named: unknown block, parameter, a required one, an option, itself inside itself", () => {
  const e = (src: string, bs = blocks) => renderView(src, data(), { blocks: bs }).errors.map((x) => x.message).join(" | ");
  assert.match(e('<use block="nope"/>'), /There is no block “nope”.*crm\.deal-card/);
  assert.match(e('<use block="crm.deal-card" colour="x"/>'), /no parameter “colour”.*amount, tone/);
  assert.match(e('<use block="counter"/>'), /needs items=/);
  assert.match(e('<list source="rows"><use block="crm.deal-card" tone="loud"/></list>'), /tone="loud".*plain, good/);
  const self = normalizeBlock({ name: "loop", description: "", params: [], template: '<use block="loop"/>' });
  assert.match(e('<use block="loop"/>', [self]), /stands in itself/);
  const bad = normalizeBlock({ name: "bad", description: "", params: [], template: "<tile label=x/>{{ rows | nofilter }}" });
  assert.match(e('<use block="bad"/>', [bad]), /block “bad”, line 1: There is no filter “nofilter”/);
  assert.deepEqual(renderView('<use block="nope"/>', data(), { blocks: null }).errors, [], "blocks not read yet: nothing drawn, nothing said");
});

test("normalizeBlock: names, parameters and template checked; the signature the help shows", () => {
  assert.throws(() => normalizeBlock({ name: "Bad Name", template: "x" }), /lowercase/);
  assert.throws(() => normalizeBlock({ name: "ok", template: "" }), /needs a template/);
  assert.throws(() => normalizeBlock({ name: "ok", template: "x", params: [{ name: "block" }] }), /own attribute/);
  assert.throws(() => normalizeBlock({ name: "ok", template: "x", params: [{ name: "a" }, { name: "A" }] }), /twice/);
  assert.equal(blockSignature(counter), '<use block="counter" items="rows | …" label="text"?/>');
});

test("<let> names a value for what follows; <switch> picks a case", () => {
  const r = renderView('<let name="open" value="rows | where(\'Status\', \'in\', \'Offen|Wartet\')"/>{{ open | count }}·<list source="open | sort(\'Amount\', \'desc\')">{{ title }}<switch on="{{ Status }}"><case value="Wartet">!</case><otherwise>.</otherwise></switch></list>', data(), { blocks });
  assert.deepEqual(r.errors, []);
  assert.match(vnodeToString(r.nodes), /^3·<list.*Beta!.*Alpha\..*Delta\./);
  assert.match(renderView('<let name="rows" value="1"/>', data()).errors[0].message, /taken/);
});

test("groupby, distinct, offset, reverse, between", () => {
  const r = renderView("{{#each rows | groupby('Owner')}}{{ group }}={{ count }};{{/each}} {{ rows | distinct('Status') | join('/') }} {{ rows | offset(3) | count }} {{ rows | reverse | limit(1) | json }} {{ rows | between('Due', '2026-11-01', '2026-11-10') | count }}", data());
  assert.deepEqual(r.errors, []);
  assert.equal(vnodeToString(r.nodes), 'Anna=2;Ben=2; Offen/Wartet/Erledigt 1 [{"id":4,"title":"Delta"}] 2');
  const g = renderView("{{#each rows | groupby('Status')}}<list source=\"this.items\">{{ title }}</list>{{/each}}", data());
  assert.deepEqual(find(g.nodes, "list").map((l) => l.c.length), [2, 1, 1]);
});

test("tabset draws only the tab shown; dialog only while open; input and slider start with their value", () => {
  const src = '<tabset bind="t"><tab id="a" label="A" n="2">first</tab><tab id="b" label="B">second</tab></tabset><dialog bind="d" title="Edit">inside</dialog><input bind="n" type="number" value="3"/><slider bind="s" min=0 max=10 value="5"/>';
  const r = renderView(src, data());
  assert.deepEqual(r.errors, []);
  const ts = find(r.nodes, "tabset")[0];
  assert.deepEqual(JSON.parse(ts.a.options), [["a", "A", "2"], ["b", "B"]]);
  assert.equal(vnodeToString(ts.c), "first");
  assert.equal(find(r.nodes, "dialog").length, 0);
  assert.deepEqual([find(r.nodes, "input")[0].a.current, find(r.nodes, "slider")[0].a.current], ["3", "5"]);
  const open = renderView(src, data({ state: { t: "b", d: "true" } }));
  assert.equal(vnodeToString(find(open.nodes, "tabset")[0].c), "second");
  assert.equal(find(open.nodes, "dialog")[0].a.title, "Edit");
});

test("calendar: the month's items on their days, paged by its state", () => {
  const r = renderView('<calendar source="rows" date="Due">{{ title }}</calendar>', data());
  assert.deepEqual(r.errors, []);
  const cal = find(r.nodes, "calendar")[0];
  assert.equal(cal.a.month, "2026-11");
  assert.deepEqual(cal.c.map((i) => (typeof i === "string" ? i : [i.a.day, i.a.row])), [["2026-11-03", "1"], ["2026-11-03", "2"], ["2026-11-20", "4"]]);
  const oct = renderView('<calendar source="rows" date="Due" bind="m">{{ title }}</calendar>', data({ state: { m: "2026-10" } }));
  assert.deepEqual(find(oct.nodes, "calendar")[0].c.map((i) => (typeof i === "string" ? i : i.a.row)), ["3"]);
});

test("heatmap: a day by day sum over the weeks to today", () => {
  const r = renderView('<heatmap source="rows" date="Due" value="Amount" weeks=4/>', data());
  assert.deepEqual(r.errors, []);
  const days = JSON.parse(find(r.nodes, "heatmap")[0].a.days) as [string, number][];
  assert.equal(days[0][0], "2026-10-19", "from the Monday three weeks back (the 10th is a Tuesday)");
  assert.equal(days.at(-1)![0], "2026-11-10", "to today (nothing from the future)");
  assert.equal(days.find((d) => d[0] === "2026-11-03")![1], 350);
  assert.equal(days.find((d) => d[0] === "2026-10-30")![1], 50);
});

test("pivot: a cross table in the options' order, with totals, formatted", () => {
  const r = renderView('<pivot source="rows" rows="Owner" cols="Status" value="Amount" format="euro(0)"/>', data());
  assert.deepEqual(r.errors, []);
  const d = JSON.parse(find(r.nodes, "pivot")[0].a.data);
  assert.deepEqual(d.rows, ["Anna", "Ben"]);
  assert.deepEqual(d.cols, ["Offen", "Wartet", "Erledigt"]);
  assert.deepEqual(d.cells, [["100 €", "", "50 €"], ["75 €", "250 €", ""]]);
  assert.deepEqual(d.rowTotals, ["150 €", "325 €"]);
  assert.equal(d.total, "475 €");
  const count = JSON.parse(find(renderView('<pivot source="rows" rows="Status"/>', data()).nodes, "pivot")[0].a.data);
  assert.deepEqual([count.cols, count.cells], [["#"], [["2"], ["1"], ["1"]]]);
});

test("rating in a row sets a number property; gauge and copy pass through", () => {
  const r = renderView('<list source="rows | limit(2)"><rating prop="Stars"/></list><gauge value="40" max="80" label="Half"/><copy text="{{ db.title }}"/>', data());
  assert.deepEqual(r.errors, []);
  assert.deepEqual(find(r.nodes, "rating").map((x) => [x.a.row, x.a.prop, x.a.value]), [["1", "stars", "4"], ["2", "stars", "0"]]);
  assert.equal(find(r.nodes, "copy")[0].a.text, "Deals");
  assert.match(renderView('<rating prop="Status"/>', data({ current: rows[0] })).errors[0].message, /number property/);
});

test("the references name the new tags, the blocks there are, and how a block is made", () => {
  const ref = viewReference([], [], blocks);
  for (const w of ["<tabset", "<dialog", "<calendar", "<heatmap", "<pivot", "<let ", "groupby(", '<use block="counter"']) assert.ok(ref.includes(w), w);
  const how = blockReference(blocks);
  for (const w of ["props.<param>", "<slot/>", 'run="@search"', "workspace_save_block", '<use block="web.finder"/>']) assert.ok(how.includes(w), w);
});
