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

test("a part holding template content; a side column of a fixed width; buttons disabled, wide, with keys; tab counts; a section that scrolls", () => {
  const r = renderView(`<split side=right width=352><col>a</col><col>b</col></split>
<part name="debts.table"><b>{{ db.title }}</b></part>
<button action="reload" label="Neu laden" disabled="{{ state.busy == 'true' }}" wide=true keys="R"/>
<tabs bind="c" options="all:Alle:12, fam:Familie:3"/>
<section title="Prüfen" scroll=20>x</section>`, data({ state: { busy: "true" } }), { parts });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(find(r.nodes, "split")[0].a, { side: "right", width: "352" });
  assert.match(vnodeToString(find(r.nodes, "part")[0].c), /Verträge/, "a part's content drawn");
  const b = find(r.nodes, "button")[0];
  assert.deepEqual([b.a.disabled, b.a.wide, b.a.keys], ["true", "true", "R"]);
  assert.deepEqual(JSON.parse(find(r.nodes, "tabs")[0].a.options), [["all", "Alle", "12"], ["fam", "Familie", "3"]]);
  assert.equal(find(r.nodes, "section")[0].a.scroll, "20");
});

test("filters read names: the view's state, a row's field; quoted words stay words", () => {
  const d = data({ state: { q: "str", st: "Aktiv" } });
  const r = renderView('{{ rows | search(state.q) | count }} · {{ rows | where("Status", state.st) | count }} · {{ rows | where("Status", "state.st") | count }}', d, { parts });
  assert.deepEqual(r.errors, []);
  assert.match(vnodeToString(r.nodes), /^1 · 3 · 0$/);
});

test("an app list's items are picked by their id (select), the pick drawn from the state a template sets", () => {
  const d = data({ app: { mails: [{ id: 41, subject: "Hallo" }, { id: 42, subject: "Rechnung" }], first: 42 } });
  const r = renderView('<state name="selected" value="{{ app.first }}"/><list source="app.mails" select=true>{{ subject }}</list>', d, { parts });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(find(r.nodes, "list")[0].c.map((i) => (typeof i === "string" ? i : i.a.row)), ["41", "42"]);
  assert.equal(r.state.selected, "42");
});

test("a row's own page: its fields are names at the top, its buttons and parts act on it", () => {
  const r = renderView('<heading>{{ title }}</heading> {{ [Pro Monat] | euro }} <button action="set" prop="Status" value="Gekündigt" label="Kündigen"/><part name="debts.table"/>', data({ current: rows[0] }), { parts });
  assert.deepEqual(r.errors, []);
  assert.match(vnodeToString(r.nodes), /Miete.*600,00\s€/);
  assert.equal(find(r.nodes, "button")[0].a.row, "1");
  assert.equal(find(r.nodes, "part")[0].a.row, "1");
});

test("a database keeps its rows' page template (a text) — none: the plugin's", async () => {
  const { normalizeSchema, newView } = await import("../src/plugins/workspace/model");
  assert.equal(normalizeSchema({ titleName: "Name", properties: [], views: [newView("T")], rowTemplate: "<b>{{ title }}</b>" }).rowTemplate, "<b>{{ title }}</b>");
  assert.equal("rowTemplate" in normalizeSchema({ titleName: "Name", properties: [], views: [newView("T")], rowTemplate: "  " }), false);
});

test("an object of the app is there or not ({{#if app.creditor}}); crossed out; a section's heading with something on the right", () => {
  const r = renderView(`{{#if app.creditor}}da{{#else}}weg{{/if}} {{#if app.none}}da{{#else}}weg{{/if}} <strike>erledigt</strike><section title="Mails" aside="7 Mails · 1 Brief">x</section>`, data({ app: { creditor: { name: "SKP" }, none: null } }), { parts });
  assert.deepEqual(r.errors, []);
  assert.match(vnodeToString(r.nodes), /^da weg /);
  assert.equal(find(r.nodes, "strike").length, 1);
  assert.equal(find(r.nodes, "section")[0].a.aside, "7 Mails · 1 Brief");
});

test("comments are left out; tabs whose options are worked out leave the start to <state>; a phone number as a link; a text keeps its line breaks", async () => {
  const { viewDefaults } = await import("../src/plugins/workspace/view-template");
  const { safeUrl } = await import("../src/plugins/workspace/card-template");
  const r = renderView('{{! a note for whoever writes the template }}<text pre=true>Zeile 1\nZeile 2</text><a href="tel:+491723420865">Anrufen</a>', data(), { parts });
  assert.deepEqual(r.errors, []);
  assert.doesNotMatch(vnodeToString(r.nodes), /note for/);
  assert.equal(find(r.nodes, "text")[0].a.pre, "true");
  assert.equal(find(r.nodes, "a")[0].a.href, "tel:+491723420865");
  assert.equal(safeUrl("javascript:alert(1)"), "");
  assert.deepEqual(viewDefaults('<state name="known" value="{{ app.first }}"/><tabs bind="known" options="{{ app.tabs }}"/>'), {});
});
