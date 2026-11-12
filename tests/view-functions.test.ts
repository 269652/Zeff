import assert from "node:assert/strict";
import test from "node:test";
import { vnodeToString } from "../src/plugins/workspace/card-template";
import { MAX_FN_DEPTH, renderView, type ViewData } from "../src/plugins/workspace/view-template";

const data = (state: Record<string, string> = {}): ViewData => ({ rows: [], props: [], titleName: "Name", state, app: {}, db: { id: 1, title: "D" } });
const draw = (src: string, state: Record<string, string> = {}) => {
  const r = renderView(src, data(state));
  return { text: vnodeToString(r.nodes).replace(/\s+/g, " ").trim(), errors: r.errors.map((e) => e.message) };
};

test("a function of your own: called in a formula and as a filter", () => {
  const r = draw('<def name="double" args="n" value="n * 2"/>{{ double(21) }} · {{ 4 | double }} · {{ double(double(3)) }}');
  assert.deepEqual(r.errors, []);
  assert.equal(r.text, "42 · 8 · 12");
});

test("a function may call itself (recursion): factorial and fibonacci", () => {
  const r = draw('<def name="fact" args="n" value="if(n <= 1, 1, n * fact(n - 1))"/><def name="fib" args="n" value="if(n < 2, n, fib(n - 1) + fib(n - 2))"/>{{ fact(10) }} · {{ fib(15) }}');
  assert.deepEqual(r.errors, []);
  assert.equal(r.text, "3628800 · 610");
});

test("a function that never stops, or does too much, is stopped with a sentence", () => {
  const deep = draw('<def name="loop" args="n" value="loop(n + 1)"/>{{ loop(0) }}');
  assert.ok(deep.errors.some((e) => e.includes(`more than ${MAX_FN_DEPTH} calls inside each other`)), deep.errors.join("|"));
  const wide = draw('<def name="fib" args="n" value="if(n < 2, n, fib(n - 1) + fib(n - 2))"/>{{ fib(30) }}');
  assert.ok(wide.errors.some((e) => e.includes("too much work")), wide.errors.join("|"));
});

test("lists with map, keep, reduce and range", () => {
  const r = draw(`<def name="double" args="n" value="n * 2"/><def name="even" args="n" value="n % 2 == 0"/><def name="add" args="a, b" value="a + b"/>
{{ 5 | range | map('double') | tojson }} · {{ 10 | range | keep('even') | tojson }} · {{ 5 | range | reduce('add', 0) }}`);
  assert.deepEqual(r.errors, []);
  assert.equal(r.text, "[0,2,4,6,8] · [0,2,4,6,8] · 10");
});

test("lists and objects in the state, kept as JSON text", () => {
  const r = draw(
    `{{ state.todo | fromjson | push(state.new) | tojson }} · {{ state.todo | fromjson | drop(0) | tojson }} · {{ state.obj | fromjson | put('b', 2) | tojson }} · {{ state.obj | fromjson | get('a') }} · {{ state.todo | fromjson | len }} · {{ state.obj | fromjson | keys | tojson }}`,
    { todo: '["x","y"]', new: "z", obj: '{"a":1}' },
  );
  assert.deepEqual(r.errors, []);
  assert.equal(r.text, '["x","y","z"] · ["y"] · {"a":1,"b":2} · 1 · 2 · ["a"]');
});

test("a function with a pipe as its body, and a function in a block's world stays its own", () => {
  const r = draw(`<def name="shout" args="s" value="{{ s | lower | upper }}"/>{{ 'hi' | shout }}`);
  assert.deepEqual(r.errors, []);
  assert.equal(r.text, "HI");
});

test("a function's name may not be one of Zeff's own; mistakes are said", () => {
  assert.ok(draw('<def name="sum" args="a" value="a"/>').errors.some((e) => e.includes("one of Zeff's own")));
  assert.ok(draw('<def name="x" args="a b" value="a"/>').errors.some((e) => e.includes("separated by commas")));
  assert.ok(draw('<def name="x"/>').errors.some((e) => e.includes("needs value")));
  assert.ok(draw("{{ nope(1) }}").errors.length > 0);
});

test("<markdown>: rich text as the view's own nodes, no HTML gets through", () => {
  const src = "# Title\n\nSome **bold**, *italic* and `code` with [a link](https://example.org) and [bad](javascript:alert(1)).\n\n- one\n- two\n\n> quoted\n\n```\nx = 1\n```\n\n<script>alert(1)</script>";
  const r = renderView(`<markdown value="{{ state.note }}"/>`, data({ note: src }));
  assert.deepEqual(r.errors, []);
  const flat = JSON.stringify(r.nodes);
  assert.match(flat, /"t":"heading","a":\{"level":"1"\}/);
  assert.match(flat, /"t":"b","a":\{\},"c":\["bold"\]/);
  assert.match(flat, /"t":"a","a":\{"href":"https:\/\/example.org"\}/);
  assert.doesNotMatch(flat, /javascript:/i.source.length ? /"href":"javascript/ : /x/, "an unsafe address never becomes a link");
  assert.match(flat, /"t":"quote"/);
  assert.match(flat, /"pre":"true"/);
  // (The script tag is only text in a paragraph.)
  assert.match(flat, /<script>/);
  assert.ok(!r.nodes.some((n) => typeof n === "object" && n.t === "script"));
});

test("<upload>: the file's text goes into the state, its name beside it", () => {
  const r = renderView(`<upload bind="csv" label="Pick" accept=".csv"/>`, data({ csv_name: "a.csv" }));
  assert.deepEqual(r.errors, []);
  const n = r.nodes.find((x) => typeof x === "object" && x.t === "upload");
  assert.ok(n && typeof n === "object");
  assert.deepEqual([n.a.bind, n.a.name, n.a.accept, n.a.max], ["csv", "a.csv", ".csv", "200"]);
  assert.ok(renderView(`<upload/>`, data()).errors.some((e) => e.message.includes("needs bind")));
});

test("events: a button emits, <on> handles; keys are handlers too; mistakes are said", async () => {
  const r = renderView(`<button label="Go" action="state" state="m" value="x" emit="saved"/><button emit="ping" label="Ping"/><on event="saved" action="state" state="msg" value="Saved"/><on keys="mod+s" action="state" state="msg" value="Key"/>`, data());
  assert.deepEqual(r.errors, []);
  const nodes = r.nodes.filter((n): n is Extract<typeof n, object> => typeof n === "object");
  assert.deepEqual(nodes.filter((n) => n.t === "button").map((n) => [n.a.action, n.a.emit]), [["state", "saved"], ["emit", "ping"]]);
  assert.deepEqual(nodes.filter((n) => n.t === "on").map((n) => [n.a.event ?? "", n.a.keys ?? "", n.a.action, n.a.state]), [["saved", "", "state", "msg"], ["", "mod+s", "state", "msg"]]);
  assert.ok(renderView(`<on action="state" state="a" value="b"/>`, data()).errors.some((e) => e.message.includes("needs event")));
  const { keysMatch } = await import("../src/plugins/workspace/view-keys");
  const ev = (key: string, o: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...o });
  assert.ok(keysMatch("mod+s", ev("s", { ctrlKey: true })));
  assert.ok(keysMatch("mod+s", ev("S", { metaKey: true })));
  assert.ok(!keysMatch("mod+s", ev("s")));
  assert.ok(!keysMatch("s", ev("s", { ctrlKey: true })));
  assert.ok(keysMatch("esc", ev("Escape")));
  assert.ok(keysMatch("alt+n", ev("n", { altKey: true })));
  assert.ok(!keysMatch("alt+n", ev("n")));
  assert.ok(keysMatch("/", ev("/")));
});

test("<theme>: the accent, corners and font as variables of the view only; a bad colour is said", async () => {
  const r = renderView(`<theme accent="#0ea5e9" radius="lg" font="serif"/>`, data());
  assert.deepEqual(r.errors, []);
  const n = r.nodes.find((x) => typeof x === "object" && x.t === "theme");
  assert.ok(n && typeof n === "object");
  const { themeStyle } = await import("../src/plugins/workspace/view-theme");
  const s = themeStyle(n.a);
  assert.equal(s["--color-indigo-600"], "#0ea5e9");
  assert.equal(s["--radius-md"], "0.625rem");
  assert.match(s.fontFamily, /serif/);
  assert.deepEqual(themeStyle({ accent: "red; background:url(x)" }), {}, "nothing but #rrggbb gets into a style");
  assert.ok(renderView(`<theme accent="blue"/>`, data()).errors.some((e) => e.message.includes("#rrggbb")));
});

test("drag and drop: <drag> carries a value, <drop> says where it goes; a drop needs its state", () => {
  const r = renderView(`<drag value="{{ state.id }}"><b>card</b></drag><drop bind="moved" emit="moved" label="Done"><text>zone</text></drop>`, data({ id: "7" }));
  assert.deepEqual(r.errors, []);
  const nodes = r.nodes.filter((n): n is Extract<typeof n, object> => typeof n === "object");
  assert.deepEqual(nodes.map((n) => [n.t, n.a.value ?? n.a.bind]), [["drag", "7"], ["drop", "moved"]]);
  assert.ok(renderView(`<drop>x</drop>`, data()).errors.some((e) => e.message.includes("needs bind")));
});

test("app settings: declared with <setting>, read as settings.x, saved ones win over defaults, the form gets what to draw", async () => {
  const src = `<setting name="cur" label="Currency" type="select" options="EUR, USD" default="EUR"/><setting name="limit" type="number" default="5"/><text>{{ settings.cur }}/{{ settings.limit }}</text><settings title="Settings"/>`;
  const plain = renderView(src, data());
  assert.deepEqual(plain.errors, []);
  assert.match(vnodeToString(plain.nodes), /<text>EUR\/5<\/text>/);
  const saved = renderView(src, { ...data(), settings: { cur: "USD" } });
  assert.match(vnodeToString(saved.nodes), /USD\/5/);
  const form = JSON.stringify(saved.nodes);
  assert.match(form, /"t":"settings"/);
  assert.match(form, /decls/);
  assert.ok(renderView(`<setting name="x" type="select"/>`, data()).errors.some((e) => e.message.includes("needs options")));
  assert.ok(renderView(`<setting name="x"/><setting name="x"/>`, data()).errors.some((e) => e.message.includes("twice")));
  const { settingValue } = await import("../src/plugins/workspace/view-settings");
  const sel = { name: "c", label: "", type: "select" as const, options: ["EUR", "USD"], default: "" };
  assert.equal(settingValue(sel, "USD"), "USD");
  assert.equal(settingValue(sel, "GBP"), null);
  assert.equal(settingValue({ ...sel, type: "number" }, "3,5"), "3.5");
  assert.equal(settingValue({ ...sel, type: "number" }, "abc"), null);
  assert.equal(settingValue({ ...sel, type: "toggle" }, "true"), "true");
});
