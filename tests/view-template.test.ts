import assert from "node:assert/strict";
import test from "node:test";
import { vnodeToString, type VNode } from "../src/plugins/workspace/card-template";
import type { Property, Row } from "../src/plugins/workspace/model";
import { renderView, viewReference, type ViewData } from "../src/plugins/workspace/view-template";

const props: Property[] = [
  { id: "st", name: "Status", type: "status", options: [{ id: "a", name: "Aktiv", color: "green" }, { id: "k", name: "Gekündigt", color: "gray" }] },
  { id: "pm", name: "Pro Monat", type: "number", format: "euro" },
  { id: "due", name: "Fällig", type: "date" },
] as Property[];
const row = (id: number, title: string, st: string, pm: number, due?: string): Row => ({ id, title, icon: "", cells: { st, pm, ...(due ? { due } : {}) }, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" }) as Row;
const rows = [row(1, "Miete", "a", 600, "2026-11-01"), row(2, "Strom", "a", 80), row(3, "Altvertrag", "k", 50), row(4, "Claude", "a", 200)];
const data = (over: Partial<ViewData> = {}): ViewData => ({ rows, props, titleName: "Vertrag", state: {}, app: { open: 12.5, payments: [{ name: "SKP", amount: 500 }] }, db: { id: 7, title: "Verträge" }, now: new Date("2026-10-22T10:00:00"), ...over });
const parts = [{ name: "debts.table", description: "The debts as a table", attrs: { dir: "owe | owed" } }];
const find = (nodes: VNode[], t: string): Extract<VNode, object>[] => nodes.flatMap((n) => (typeof n === "string" ? [] : [...(n.t === t ? [n] : []), ...find(n.c, t)]));

test("layout with the app's figures and the view's state: a grid of tiles, values formatted", () => {
  const r = renderView('<state name="dir" value="owe"/><grid cols=2><tile label="Offen" value="{{ app.open | euro }}" sub="{{ state.dir }}"/></grid>', data(), { parts });
  assert.deepEqual(r.errors, []);
  assert.equal(r.state.dir, "owe", "a state's first value");
  const tile = find(r.nodes, "tile")[0];
  assert.equal(find(r.nodes, "grid")[0].a.cols, "2");
  assert.match(tile.a.value, /12,50\s€/);
  assert.equal(tile.a.sub, "owe");
});

test("the rows as a collection: where, sort, limit, sum, count, search", () => {
  const r = renderView('{{ rows | where("Status", "Aktiv") | sum("Pro Monat") | euro }} · {{ rows | count }} · {{ rows | search("str") | count }}', data(), { parts });
  assert.deepEqual(r.errors, []);
  assert.match(vnodeToString(r.nodes), /880,00\s€ · 4 · 1/);
  const s = renderView('{{#each rows | sort("Pro Monat", "desc") | limit(2)}}<row>{{ title }}<button action="open" label="Öffnen"/></row>{{/each}}', data(), { parts });
  assert.deepEqual(s.errors, []);
  assert.deepEqual(find(s.nodes, "button").map((b) => [b.a.action, b.a.row]), [["open", "1"], ["open", "4"]], "a button in a row acts on it");
  assert.match(vnodeToString(s.nodes), /Miete.*Claude/);
});

test("list, cards and table of rows; a chart's data summed by a column", () => {
  const r = renderView(`<list source="rows | where('Status', 'Aktiv')" select=true><b>{{ title }}</b> {{ Status | chip }}</list>
<table source="rows" columns="title, Status, [Pro Monat]" sum="Pro Monat"/>
<chart kind="pie" source="rows" group="Status" value="Pro Monat" calc="sum"/>`, data(), { parts });
  assert.deepEqual(r.errors, []);
  const list = find(r.nodes, "list")[0];
  assert.deepEqual(list.c.map((i) => (typeof i === "string" ? i : i.a.row)), ["1", "2", "4"]);
  assert.equal(list.a.select, "true");
  const table = find(r.nodes, "table")[0];
  assert.deepEqual(JSON.parse(table.a.columns), ["title", "st", "pm"]);
  assert.deepEqual(JSON.parse(table.a.rows), [1, 2, 3, 4]);
  assert.equal(table.a.sum, "pm");
  assert.deepEqual(JSON.parse(find(r.nodes, "chart")[0].a.data), [
    { label: "Aktiv", value: 880, color: "green" },
    { label: "Gekündigt", value: 50, color: "gray" },
  ]);
});

test("the app's lists: each item's fields by name", () => {
  const r = renderView("{{#each app.payments}}{{ name }}: {{ amount | euro }}{{/each}}", data(), { parts });
  assert.deepEqual(r.errors, []);
  assert.match(vnodeToString(r.nodes), /SKP: 500,00\s€/);
});

test("parts and widgets: by name, their attributes passed on (interpolated); an unknown part, action or tag is an error", () => {
  const r = renderView('<state name="dir" value="owed"/><part name="debts.table" dir="{{ state.dir }}"/><widget id="cases.due" days=14/>', data(), { parts });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(find(r.nodes, "part")[0].a, { name: "debts.table", dir: "owed" });
  assert.deepEqual(find(r.nodes, "widget")[0].a, { id: "cases.due", days: "14" });
  const bad = renderView('<part name="nope"/><button action="explode"/><button action="set" prop="Status" value="Aktiv"/><blink/>', data(), { parts });
  assert.deepEqual(bad.errors.map((e) => e.message.slice(0, 22)), ["Unknown tag <blink> — ", "There is no part “nope", "There is no action “ex", "“set” acts on a row — "]);
});

test("the row picked (a list's select): its fields in <selected>; none picked: its empty text", () => {
  assert.match(vnodeToString(renderView('<selected empty="Nichts gewählt">{{ title }} · {{ [Pro Monat] | euro }}</selected>', data({ state: { selected: "2" } }), { parts }).nodes), /Strom · 80,00\s€/);
  assert.match(vnodeToString(renderView('<selected empty="Nichts gewählt">{{ title }}</selected>', data(), { parts }).nodes), /Nichts gewählt/);
});

test("tabs, search, select and toggle are bound to the view's state; a set button inside a row names its option", () => {
  const r = renderView('<tabs bind="dir" options="owe:Gläubiger, owed:Schuldner"/><search bind="q"/>{{#each rows | limit(1)}}<button action="set" prop="Status" value="Gekündigt" label="Kündigen"/>{{/each}}', data(), { parts });
  assert.deepEqual(r.errors, []);
  assert.equal(r.state.dir, "owe", "tabs: the first option when nothing is set");
  assert.deepEqual(JSON.parse(find(r.nodes, "tabs")[0].a.options), [["owe", "Gläubiger"], ["owed", "Schuldner"]]);
  const b = find(r.nodes, "button")[0];
  assert.deepEqual([b.a.prop, b.a.value, b.a.row], ["st", "k", "1"], "the property's id and the option's id");
});

test("the reference names every tag, filter, action and the app's parts", () => {
  const ref = viewReference(parts);
  for (const w of ["<grid", "<list", "<table", "<button", "action=", "where(", "sum(", "debts.table", "<part", "<widget", "state.", "app."]) assert.ok(ref.includes(w), w);
});

test("the state a template starts with, read before it is drawn: its <state> values, the first option of its tabs", async () => {
  const { viewDefaults } = await import("../src/plugins/workspace/view-template");
  assert.deepEqual(viewDefaults('<state name="q" value=""/><section title="x"><tabs bind="dir" options="owe:A, owed:B"/></section>'), { q: "", dir: "owe" });
});

test("a table of any list: columns with their own cell templates (and a foot), buttons that name their row, dots and bars in a colour of their own", () => {
  const d = data({ app: { debts: [{ id: 11, name: "SKP", open: 1200, color: "#f59e0b" }, { id: 12, name: "DKB", open: 300, color: "#0ea5e9" }] } });
  const r = renderView(`<datatable source="app.debts" empty="Nichts">
  <column label="Wer"><dot color="{{ color }}"/> <b>{{ name }}</b></column>
  <column label="Offen" align=right foot="{{ app.debts | sum('open') | euro(0) }}">{{ open | euro(0) }}<bar value="{{ open }}" max=1500 fill="{{ color }}"/></column>
  <column label=""><button action="open" row="{{ id }}" label="Öffnen"/></column>
</datatable>`, d, { parts });
  assert.deepEqual(r.errors, []);
  const table = find(r.nodes, "datatable")[0];
  assert.deepEqual(JSON.parse(table.a.cols).map((c: { label: string; align?: string; foot?: string }) => [c.label, c.align ?? "", c.foot ?? ""]), [["Wer", "", ""], ["Offen", "right", "1.500 €"], ["", "", ""]]);
  const rows = table.c.filter((x): x is Extract<VNode, object> => typeof x !== "string");
  assert.equal(rows.length, 2);
  assert.match(vnodeToString(rows[0]), /SKP.*1\.200 €/);
  assert.equal(find(r.nodes, "dot")[0].a.color, "#f59e0b");
  assert.equal(find(r.nodes, "bar")[0].a.fill, "#f59e0b");
  assert.deepEqual(find(r.nodes, "button").map((b) => b.a.row), ["11", "12"], "a row named by the button");
  const empty = renderView('<datatable source="app.none" empty="Nichts"><column label="x">{{ name }}</column></datatable>', d, { parts });
  assert.equal(find(empty.nodes, "datatable")[0].a.empty, "Nichts");
});

test("a tile with content under its value (a part, text); a chart of an app's list in its items' colours; euro with digits", () => {
  const r = renderView('<tile label="Übrig" value="{{ app.left | euro(0) }}" tone=good><part name="debts.table"/> · fix</tile><chart kind=bar source="app.list" group="name" value="amount"/>', data({ app: { left: 1009.4, list: [{ name: "Miete", amount: 600, color: "#c4b5fd" }] } }), { parts });
  assert.deepEqual(r.errors, []);
  const tile = find(r.nodes, "tile")[0];
  assert.equal(tile.a.value, "1.009 €");
  assert.equal(find(tile.c, "part").length, 1);
  assert.deepEqual(JSON.parse(find(r.nodes, "chart")[0].a.data), [{ label: "Miete", value: 600, color: "#c4b5fd" }]);
});

test("tooltips (tip), monospace, a box taking the room left (fill) with text cut to one line, roomy lists, buttons kept on paper", () => {
  const r = renderView(`<row><col fill=true><truncate tip="{{ app.open | euro }}">Ein sehr langer Name</truncate></col><mono>DR II 810/26</mono><text tip="aus Briefen">x</text></row>
<list source="rows | limit(1)" spacing=roomy>{{ title }}</list><button action="print" label="Drucken" print=true tip="Als PDF"/>`, data(), { parts });
  assert.deepEqual(r.errors, []);
  assert.equal(find(r.nodes, "col")[0].a.fill, "true");
  assert.match(find(r.nodes, "truncate")[0].a.tip, /12,50\s€/);
  assert.equal(find(r.nodes, "mono").length, 1);
  assert.equal(find(r.nodes, "text")[0].a.tip, "aus Briefen");
  assert.equal(find(r.nodes, "list")[0].a.spacing, "roomy");
  const b = find(r.nodes, "button")[0];
  assert.deepEqual([b.a.print, b.a.tip], ["true", "Als PDF"]);
});
