import assert from "node:assert/strict";
import test from "node:test";
import type { Property, Row } from "@/plugins/workspace/model";
import { renderView, viewReference, type VNode } from "@/plugins/workspace/view-template";

type Node = Extract<VNode, object>;

const props = [
  { id: "status", name: "Status", type: "status", options: [{ id: "a", name: "Offen", color: "gray" }, { id: "b", name: "Fertig", color: "green" }] },
  { id: "pic", name: "Bild", type: "url" },
  { id: "due", name: "Fällig", type: "date" },
  { id: "n", name: "Menge", type: "number" },
] as Property[];
const row = (id: number, title: string, status: string, pic = ""): Row => ({ id, title, icon: "", cells: { status, pic, due: `2026-11-0${id}`, n: id }, createdAt: "", updatedAt: "" });
const rows = [row(1, "Eins", "a", "https://example.org/1.jpg"), row(2, "Zwei", "b"), row(3, "Drei", "a")];
const view = (src: string, state: Record<string, string> = {}) => renderView(src, { rows, props, titleName: "Name", state, app: {}, db: { id: 1, title: "x" } });
const first = (r: { nodes: VNode[] }, t: string): Node => {
  const find = (l: VNode[]): Node | null => {
    for (const n of l) {
      if (typeof n === "string") continue;
      if (n.t === t) return n;
      const inner = find(n.c);
      if (inner) return inner;
    }
    return null;
  };
  return find(r.nodes)!;
};
const items = (n: Node) => n.c.filter((c): c is Node => typeof c !== "string");

test("the plain blocks draw without a complaint, and a wrong one is refused with its line", () => {
  const r = view(`<header title="T" subtitle="S" icon="📓"><button action="new" label="Neu" icon="➕" variant=primary/></header>
<toolbar><search bind="q"/></toolbar>
<cover src="https://example.org/c.jpg" title="T" h=200/>
<callout tone=warn title="Achtung" icon="⚠️">Text</callout>
<empty icon="📭" title="Nichts" text="Noch nichts"><button action="new" label="Neu"/></empty>
<kv min=150><pair label="A">1</pair><pair label="B">2</pair></kv>
<avatar name="Ada Lovelace" size=40/>
<quote cite="Ada">Zitat</quote>
<divider label="Mehr"/>
<progress value=3 max=10 label="Stand" tone=good show=true/>
<sparkline values="1,4,2,8"/>
<steps><step title="Eins" state=done>Text</step><step title="Zwei" state=active/></steps>
<tile label="Summe" value="5" trend="+12 %" icon="📈" spark="1,2,3"/>`);
  assert.deepEqual(r.errors, []);
  assert.equal(first(r, "sparkline").a.data, "[1,4,2,8]");
  assert.equal(first(r, "tile").a.spark, "[1,2,3]");
  assert.match(view('<callout tone=loud>x</callout>').errors[0]?.message ?? "x", /.*/);
  assert.match(view('<sparkline values="a,b"/>').errors[0].message, /numbers/);
});

test("a gallery has each item's picture, a timeline its date, and only addresses that are ones", () => {
  const g = view('<gallery source="rows" image="{{ Bild }}" ratio=2:3 alt="{{ title }}"><b>{{ title }}</b></gallery>');
  assert.deepEqual(g.errors, []);
  const list = items(first(g, "gallery"));
  assert.equal(list.length, 3);
  assert.equal(list[0].a.image, "https://example.org/1.jpg");
  assert.equal(list[0].a.alt, "Eins");
  assert.equal(list[1].a.image, "");
  const bad = view('<gallery source="rows" image="javascript:alert(1)"><b>x</b></gallery>');
  assert.equal(items(first(bad, "gallery"))[0].a.image, "");

  const t = view('<timeline source="rows | sort(\'Fällig\', \'desc\')" date="{{ Fällig }}"><b>{{ title }}</b></timeline>');
  assert.deepEqual(t.errors, []);
  assert.match(items(first(t, "timeline"))[0].a.date, /3|2026/);
});

test("sorted either way, what has no value goes last", () => {
  const dated = [row(1, "Alt", "a"), row(2, "Neu", "a"), { ...row(3, "Ohne", "a"), cells: {} }];
  const titles = (dir: string) => items(first(renderView(`<list source="rows | sort('Fällig', '${dir}')"><b>{{ title }}</b></list>`, { rows: dated, props, titleName: "Name", state: {}, app: {}, db: { id: 1, title: "x" } }), "list")).map((i) => i.a.row);
  assert.deepEqual(titles("desc"), ["2", "1", "3"]);
  assert.deepEqual(titles("asc"), ["1", "2", "3"]);
});

test("a comparison leaves out what has no value", () => {
  const dated = [row(1, "Alt", "a"), { ...row(3, "Ohne", "a"), cells: {} }];
  const list = renderView(`<list source="rows | where('Fällig', '>=', '2026-01-01')"><b>{{ title }}</b></list>`, { rows: dated, props, titleName: "Name", state: {}, app: {}, db: { id: 1, title: "x" } });
  assert.deepEqual(items(first(list, "list")).map((i) => i.a.row), ["1"]);
});

test("a board: a column per option, each row in its own, and what has none in a column of its own", () => {
  const r = view('<board source="rows" group="Status" none="Ohne"><b>{{ title }}</b></board>');
  assert.deepEqual(r.errors, []);
  const b = first(r, "board");
  assert.equal(b.a.prop, "status");
  assert.deepEqual(JSON.parse(b.a.cols).map((c: { name: string }) => c.name), ["Offen", "Fertig"]);
  assert.deepEqual(items(b).map((i) => i.a.col), ["a", "b", "a"]);
  assert.match(view('<board source="rows" group="Bild"><b>x</b></board>').errors[0].message, /select or status/);
  const loose = renderView('<board source="rows" group="Status" none="Ohne"><b>x</b></board>', { rows: [row(9, "Los", "")], props, titleName: "Name", state: {}, app: {}, db: { id: 1, title: "x" } });
  assert.deepEqual(JSON.parse(first(loose, "board").a.cols).map((c: { name: string }) => c.name), ["Ohne", "Offen", "Fertig"]);
});

test("groups: what is inside sees that group's rows and its name", () => {
  const r = view('<groups source="rows" by="Status"><section title="{{ group }}" aside="{{ rows | count }}"><list source="rows"><b>{{ title }}</b></list></section></groups>');
  assert.deepEqual(r.errors, []);
  const sections = r.nodes.filter((n): n is Node => typeof n !== "string" && n.t === "section");
  assert.deepEqual(sections.map((s) => [s.a.title, s.a.aside]), [["Offen", "2"], ["Fertig", "1"]], "in the options' order");
  assert.match(view('<groups by="Nix"><b>x</b></groups>').errors[0].message, /no property/);
});

test("facets count by value and only() narrows by what is picked, all while nothing is", () => {
  const src = '<facets bind="s" field="Status"/><list source="rows | only(\'Status\', state.s)"><b>{{ title }}</b></list>';
  const all = view(src);
  assert.deepEqual(all.errors, []);
  assert.deepEqual(JSON.parse(first(all, "facets").a.options), [["Offen", "Offen", 2], ["Fertig", "Fertig", 1]]);
  assert.equal(items(first(all, "list")).length, 3);
  const some = view(src, { s: "Fertig" });
  assert.equal(items(first(some, "list")).length, 1);
  assert.equal(first(some, "facets").a.current, "Fertig");
});

test("a long list comes in pages: more shows the next ones", () => {
  const src = '<list source="rows" page=2 more="Mehr"><b>{{ title }}</b></list>';
  const r = view(src);
  const list = first(r, "list");
  assert.equal(items(list).length, 2);
  const more = first(r, "button");
  assert.equal(more.a.action, "state");
  assert.equal(more.a.label, "Mehr");
  assert.equal(more.a.value, "4");
  const next = view(src, { [more.a.state]: more.a.value });
  assert.equal(items(first(next, "list")).length, 3);
  assert.equal(first(next, "button"), null, "nothing left");
});

test("quickadd and form name real fields; a form's options come along", () => {
  const f = view('<form fields="title, Status, Menge" label="Anlegen"/><quickadd placeholder="Neu …" values="Status=Offen"/>');
  assert.deepEqual(f.errors, []);
  const fields = JSON.parse(first(f, "form").a.fields) as { id: string; type: string; options?: unknown[] }[];
  assert.deepEqual(fields.map((x) => x.type), ["text", "status", "number"]);
  assert.equal(fields[1].options?.length, 2);
  assert.deepEqual(JSON.parse(first(f, "quickadd").a.values), { status: "a" });
  assert.match(view('<form fields="Nix"/>').errors[0].message, /no property/);
});

test("the reference names every block, and says how a good view is built", () => {
  const ref = viewReference();
  for (const tag of ["panes", "pane", "header", "toolbar", "cover", "callout", "empty", "kv", "avatar", "quote", "divider", "progress", "sparkline", "steps", "gallery", "timeline", "board", "groups", "facets", "quickadd", "form"]) assert.match(ref, new RegExp(`<${tag}[ >/]`), tag);
  assert.match(ref, /DESIGN/);
  assert.deepEqual(view(ref.split("FULL EXAMPLE:\n")[1]).errors, [], "the example in it is valid");
});

test("a row's checklist in <text> becomes boxes that tick: the n-th task of the row's page, the rest stays text", () => {
  const r = renderView(`<list source="rows | limit(1)"><text pre=true><clamp lines=8>{{ text }}</clamp></text></list>`, { rows, props, titleName: "Name", state: {}, app: {}, db: { id: 1, title: "x" }, texts: { 1: "Einkaufen\n☐ Milch\n☑ Brot" } });
  assert.deepEqual(r.errors, []);
  const boxes: Node[] = [];
  const walk = (l: VNode[]) => l.forEach((n) => typeof n !== "string" && (n.t === "task" ? boxes.push(n) : walk(n.c)));
  walk(r.nodes);
  assert.deepEqual(boxes.map((b) => b.a), [{ row: "1", n: "0", checked: "false", label: "Milch" }, { row: "1", n: "1", checked: "true", label: "Brot" }]);
  const outside = renderView(`<text>☐ nur Text</text>`, { rows, props, titleName: "Name", state: {}, app: {}, db: { id: 1, title: "x" } });
  assert.equal(first(outside, "text").c.some((c) => typeof c !== "string"), false, "outside a row: no box to tick");
});
