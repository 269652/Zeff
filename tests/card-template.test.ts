import assert from "node:assert/strict";
import test from "node:test";
import { cardScope, parseTemplate, renderTemplate, vnodeToString, type VNode } from "@/plugins/workspace/card-template";
import { normalizeSchema, newProperty, type Property, type Row } from "@/plugins/workspace/model";

/**
 * Card templates: a small, safe language for how a row looks as a card on a board or in a gallery — tags from a fixed list, {{ values | filters }},
 * {{#if}} and {{#each}}. No script, no raw HTML: the result is a tree of known nodes that the page draws with its own components.
 */
const status: Property = { id: "st", name: "Status", type: "status", options: [{ id: "o1", name: "In Arbeit", color: "blue", group: "doing" }, { id: "o2", name: "Fertig", color: "green", group: "done" }] };
const tags: Property = { id: "tg", name: "Labels", type: "multi_select", options: [{ id: "t1", name: "Story", color: "purple" }, { id: "t2", name: "Bug", color: "red" }] };
const hours: Property = { id: "h", name: "Hours", type: "number" };
const est: Property = { id: "e", name: "Estimate", type: "number" };
const booked: Property = { id: "hb", name: "Hours booked", type: "number" };
const due: Property = { id: "d", name: "Due", type: "date" };
const done: Property = { id: "dn", name: "Done", type: "checkbox" };
const url: Property = { id: "u", name: "Link", type: "url" };
const props = [status, tags, hours, est, booked, due, done, url];
const row = (cells: Record<string, unknown>, title = "Footer umbauen"): Row => ({ id: 7, title, icon: "🦶", cells, createdAt: "2026-10-01T08:00:00Z", updatedAt: "2026-10-02T08:00:00Z" });
const NOW = new Date(2026, 9, 19, 12, 0);

const render = (src: string, cells: Record<string, unknown> = {}, title?: string) => {
  const p = parseTemplate(src);
  assert.deepEqual(p.errors, [], `parse: ${JSON.stringify(p.errors)}`);
  const out = renderTemplate(p.nodes, cardScope({ row: row(cells, title), props, titleName: "Ticket", now: NOW }));
  return { out: vnodeToString(out.nodes), errors: out.errors, nodes: out.nodes as VNode[] };
};

test("values: the title, a property by name (also one with spaces in brackets), the special names", () => {
  assert.equal(render("{{ title }} / {{ Status }} / {{ [Hours booked] }}", { st: "o1", hb: 3.5 }).out, "Footer umbauen / In Arbeit / 3.5");
  assert.equal(render("{{ icon }} {{ id }}").out, "🦶 7");
  assert.equal(render("{{ status }}", { st: "o2" }).out, "Fertig", "names don't care about case");
  assert.equal(render("[{{ Hours }}]").out, "[]", "a property without a value is nothing");
});

test("filters: chip (the option's colour), date, hours, upper, truncate, default, join, count, check", () => {
  assert.equal(render("{{ Status | chip }}", { st: "o1" }).out, "<chip color=blue>In Arbeit</chip>");
  assert.equal(render("{{ Labels | chip }}", { tg: ["t1", "t2"] }).out, "<chip color=purple>Story</chip><chip color=red>Bug</chip>");
  assert.equal(render("{{ Due | date }}", { d: "2026-10-23" }).out, "23 Oct");
  assert.equal(render("{{ Hours | hours }}", { h: 1.5 }).out, "1.5 h");
  assert.equal(render("{{ title | upper }}").out, "FOOTER UMBAUEN");
  assert.equal(render("{{ title | truncate(6) }}").out, "Footer…");
  assert.equal(render("{{ Estimate | default(\"–\") }}").out, "–");
  assert.equal(render("{{ Labels | join(\" · \") }}", { tg: ["t1", "t2"] }).out, "Story · Bug");
  assert.equal(render("{{ Labels | count }}", { tg: ["t1", "t2"] }).out, "2");
  assert.equal(render("{{ Done | check }}", { dn: true }).out, "✓");
  assert.equal(render("{{ Due | relative }}", { d: "2026-10-21" }).out, "in 2 days");
  assert.equal(render("{{ Due | relative }}", { d: "2026-10-18" }).out, "1 day ago");
  assert.equal(render("{{ Due | relative }}", { d: "2026-10-19" }).out, "today");
});

test("layout tags and bars: row, col, grow, b, muted, bar with a value and a maximum, img, a", () => {
  assert.equal(render("<row gap=2><b>{{ title }}</b><grow/><muted>{{ id }}</muted></row>").out, "<row gap=2><b>Footer umbauen</b><grow></grow><muted>7</muted></row>");
  const bar = render("<bar value={{ [Hours booked] }} max={{ Estimate }} />", { hb: 3, e: 4 }).out;
  assert.equal(bar, "<bar value=3 max=4></bar>");
  assert.equal(render("{{ [Hours booked] | bar(8) }}", { hb: 2 }).out, "<bar value=2 max=8></bar>");
  assert.equal(render('<a href="{{ Link }}">open</a>', { u: "https://example.com/x" }).out, '<a href=https://example.com/x>open</a>');
  assert.equal(render('<img src="{{ Link }}" h=80 fit=cover />', { u: "https://example.com/a.png" }).out, "<img src=https://example.com/a.png h=80 fit=cover></img>");
});

test("{{#if}} with comparisons and logic, {{#else}}, {{#each}}", () => {
  const src = "{{#if [Hours booked] > Estimate}}over{{#else}}ok{{/if}}";
  assert.equal(render(src, { hb: 5, e: 4 }).out, "over");
  assert.equal(render(src, { hb: 3, e: 4 }).out, "ok");
  assert.equal(render("{{#if Status == \"Fertig\" and Done}}x{{/if}}", { st: "o2", dn: true }).out, "x");
  assert.equal(render("{{#if Due < today()}}late{{/if}}", { d: "2026-10-01" }).out, "late");
  assert.equal(render("{{#if Due < today()}}late{{/if}}", { d: "2026-12-01" }).out, "");
  assert.equal(render("{{#if Labels}}tagged{{/if}}", { tg: ["t1"] }).out, "tagged");
  assert.equal(render("{{#if Labels}}tagged{{/if}}").out, "", "an empty list is false");
  assert.equal(render("{{#each Labels}}<chip>{{ this }}</chip>{{/each}}", { tg: ["t1", "t2"] }).out, "<chip>Story</chip><chip>Bug</chip>");
});

test("it is safe: no script, no raw HTML, no javascript: addresses, nothing outside the list", () => {
  const bad = parseTemplate("<script>alert(1)</script>");
  assert.ok(bad.errors.some((e) => /script/i.test(e.message)), "an unknown tag is an error");
  // The text is text: angle brackets in a value are not markup.
  assert.equal(render("{{ title }}", {}, "<img src=x onerror=alert(1)>").out, "<img src=x onerror=alert(1)>", "as text — the page draws it as text");
  const js = render('<a href="javascript:alert(1)">x</a>');
  assert.equal(js.out, "<a>x</a>", "an address that isn't http(s), mailto or relative is dropped");
  assert.equal(render('<img src="data:text/html,x" />').out, "<img></img>");
  assert.ok(render('<a href="{{ Link }}">x</a>', { u: "javascript:alert(1)" }).out === "<a>x</a>");
  // An attribute that isn't allowed on the tag is dropped (no onclick, no style).
  assert.equal(render('<b onclick="x()" style="color:red">y</b>').out, "<b>y</b>");
});

test("errors say what and where: an unclosed tag, an unknown filter, an expression that doesn't parse", () => {
  const open = parseTemplate("<row>\n<b>x</row>");
  assert.ok(open.errors.length && open.errors[0].line === 2, JSON.stringify(open.errors));
  const unknown = parseTemplate("{{ title | nope }}");
  const r = renderTemplate(unknown.nodes, cardScope({ row: row({}), props, titleName: "T", now: NOW }));
  assert.ok(r.errors.some((e) => /nope/.test(e.message)));
  const ex = parseTemplate("{{#if Hours >}}x{{/if}}");
  const r2 = renderTemplate(ex.nodes, cardScope({ row: row({}), props, titleName: "T", now: NOW }));
  assert.ok(r2.errors.length > 0);
  assert.ok(parseTemplate("{{#if Hours}}x").errors.length > 0, "an if that is never closed");
});

test("a view keeps its card template (cut to a sane length); other values are dropped", () => {
  const s = normalizeSchema({ titleName: "T", properties: [newProperty("A", "text")], views: [{ id: "v", name: "Board", type: "board", filter: { op: "and", rules: [] }, sorts: [], hidden: [], card: "<b>{{ title }}</b>" }, { id: "w", name: "G", type: "gallery", filter: { op: "and", rules: [] }, sorts: [], hidden: [], card: 12 }, { id: "x", name: "L", type: "gallery", filter: { op: "and", rules: [] }, sorts: [], hidden: [], card: "a".repeat(20000) }] });
  assert.equal(s.views[0].card, "<b>{{ title }}</b>");
  assert.equal(s.views[1].card, undefined);
  assert.equal(s.views[2].card!.length, 8000);
});
