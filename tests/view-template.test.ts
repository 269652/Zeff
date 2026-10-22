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
