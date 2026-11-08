import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * Flows: what a Zeff app does on the server — nodes that call actions (the web, extraction, rows), branch, loop, run a script in a
 * sandbox, wait for your approval and go on without doing twice what was done; what they may reach granted per flow; a flow as a
 * lookup source; secrets never in a log; lifecycles on a status field.
 */

async function world() {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "todos"]) setInstalled(id, true);
  await import("@/plugins/contributions");
  const w = await import("@/plugins/workspace/store");
  const s = await import("@/plugins/workspace/flows/store");
  const e = await import("@/plugins/workspace/flows/engine");
  return { w, s, e };
}

let n = 0;
const name = (base: string) => `${base}.t${++n}`;
const PUBLIC = async () => ["93.184.216.34"];

test("expressions: paths keep their values, filters shape them, a comparison after a filter", async () => {
  const { fill, evalExpr, holds } = await import("@/plugins/workspace/flows/expr");
  const s = { input: { q: " Dune ", n: 4 }, steps: { search: { hits: [{ id: 7, title: "Dune" }, { id: 9, title: "Dune 2" }] } } };
  assert.equal(fill("{{ steps.search.hits[0].id }}", s), 7);
  assert.deepEqual(fill("{{ steps.search.hits | pluck('id') }}", s), [7, 9]);
  assert.equal(fill("{{ steps.search.hits[-1].title }}", s), "Dune 2");
  assert.equal(fill("Film: {{ input.q | trim | upper }} ({{ steps.search.hits | count }})", s), "Film: DUNE (2)");
  assert.equal(evalExpr("input.n * 2 + 1", s), 9);
  assert.equal(holds("{{ steps.search.hits | count > 1 }}", s), true);
  assert.equal(evalExpr("missing.path | default('—')", s), "—");
  assert.throws(() => evalExpr("input.q | nosuch", s), /no filter/);
});

test("a flow branches, loops, runs a script in the sandbox and returns its output", async () => {
  const { s, e } = await world();
  const f = s.createFlow({
    name: name("calc"),
    inputs: [{ name: "items", type: "list", required: true }, { name: "factor", type: "number", default: 2 }],
    nodes: [
      { id: "each", kind: "foreach", items: "input.items", nodes: [{ id: "double", kind: "script", code: "return Number(item) * flowInput.factor;" }] },
      { id: "sum", kind: "script", code: "return steps.each.reduce((a, b) => a + b, 0);" },
      { id: "big", kind: "if", when: "steps.sum > 10", then: [{ id: "say", kind: "set", vars: { size: "big" } }], else: [{ id: "say2", kind: "set", vars: { size: "small" } }] },
    ],
    output: { total: "{{ steps.sum }}", size: "{{ vars.size }}", each: "{{ steps.each }}" },
  });
  const r = await e.runFlow(f, { items: "1, 2, 3" });
  assert.equal(r.status, "done", r.error ?? "");
  assert.deepEqual(r.output, { total: 12, size: "big", each: [2, 4, 6] });
  const run = s.getFlowRun(r.runId)!;
  assert.ok(run.log.some((l) => l.kind === "script" && l.status === "ok"), "every node is logged");
  await assert.rejects(() => e.runFlow(f, {}), /required/);
});

test("a script can't loop forever or reach the host; its error fails the run", async () => {
  const { s, e } = await world();
  const loop = s.createFlow({ name: name("loop"), nodes: [{ id: "x", kind: "script", code: "while (true) {}" }] });
  const r = await e.runFlow(loop);
  assert.equal(r.status, "failed");
  assert.match(r.error!, /longer than/);
  const host = s.createFlow({ name: name("host"), nodes: [{ id: "x", kind: "script", code: "return [typeof require, typeof process, typeof fetch];" }] });
  const h = await e.runFlow(host);
  assert.deepEqual(h.output, ["undefined", "undefined", "undefined"]);
});

test("the web: only granted hosts, never a private address; JSON parsed, HTML picked by CSS; secrets never in the log", async () => {
  const { s, e } = await world();
  const { setSecret } = s;
  setSecret("DEMO_KEY", "sekret-12345");
  const realFetch = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    seen.push(`${String(url)} ${JSON.stringify(init?.headers)}`);
    if (String(url).includes("/movie")) return new Response(JSON.stringify({ results: [{ id: 1, title: "Dune", key: "sekret-12345" }] }), { headers: { "content-type": "application/json" } });
    return new Response('<ul><li class="m"><a href="/a">Alien</a><span class="y">1979</span></li><li class="m"><a href="/b">Blade Runner</a><span class="y">1982</span></li></ul>', { headers: { "content-type": "text/html" } });
  }) as typeof fetch;
  try {
    const nodes = [
      { id: "api", kind: "action", action: "http.request", input: { url: "https://api.example.com/movie", query: { q: "{{ input.q }}" }, headers: { authorization: "Bearer {{ secrets.DEMO_KEY }}" } } },
      { id: "page", kind: "action", action: "web.html", input: { url: "https://www.example.com/list" } },
      { id: "pick", kind: "action", action: "extract.css", input: { html: "{{ steps.page.html }}", items: "li.m", fields: { title: "a", href: "a@href", year: "span.y" } } },
    ];
    const denied = s.createFlow({ name: name("web"), nodes });
    const r1 = await e.runFlow(denied, { q: "dune" }, { resolve: PUBLIC });
    assert.equal(r1.status, "failed");
    assert.match(r1.error!, /may not reach api\.example\.com/);

    const granted = s.createFlow({ name: name("web"), nodes, permissions: { web: ["example.com"] }, output: { first: "{{ steps.api.json.results[0].title }}", list: "{{ steps.pick.items }}", key: "{{ steps.api.json.results[0].key }}" } });
    const r2 = await e.runFlow(granted, { q: "dune" }, { resolve: PUBLIC });
    assert.equal(r2.status, "done", r2.error ?? "");
    assert.deepEqual(r2.output, { first: "Dune", list: [{ title: "Alien", href: "/a", year: "1979" }, { title: "Blade Runner", href: "/b", year: "1982" }], key: "•••" });
    assert.ok(seen[0].includes("q=dune") && seen[0].includes("Bearer sekret-12345"), "the secret goes to the API");
    const log = JSON.stringify(s.getFlowRun(r2.runId)!.log);
    assert.ok(!log.includes("sekret-12345") && log.includes("•••"), "but never into the log");

    const local = s.createFlow({ name: name("web"), nodes: [{ id: "x", kind: "action", action: "http.request", input: { url: "https://intranet.example.com/" } }], permissions: { web: ["*"] } });
    const r3 = await e.runFlow(local, {}, { resolve: async () => ["10.0.0.5"] });
    assert.match(r3.error!, /private network/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("rows: a flow writes only the databases it was granted; a dry run writes nothing", async () => {
  const { w, s, e } = await world();
  const db = w.createPage({ kind: "database", title: `Filme ${n}` });
  const nodes = [{ id: "add", kind: "action", action: "db.insert", input: { database: String(db), title: "{{ input.t }}", unique: "title" } }];
  const no = s.createFlow({ name: name("rows"), nodes });
  assert.match((await e.runFlow(no, { t: "Dune" })).error!, /may not write/);
  const yes = s.createFlow({ name: name("rows"), nodes, permissions: { write: [db] } });
  const dry = await e.runFlow(yes, { t: "Dune" }, { dry: true });
  assert.equal(dry.status, "done");
  assert.equal(w.rowsOf(db)!.rows.length, 0, "the dry run wrote nothing");
  await e.runFlow(yes, { t: "Dune" });
  const again = await e.runFlow(yes, { t: "dune" });
  assert.deepEqual(again.output, { id: w.rowsOf(db)!.rows[0].id, existed: true }, "unique: the row is there already");
  const q = s.createFlow({ name: name("rows"), nodes: [{ id: "q", kind: "action", action: "db.query", input: { database: String(db), search: "dun" } }], output: "{{ steps.q.rows | pluck('title') }}" });
  assert.deepEqual((await e.runFlow(q)).output, ["Dune"]);
});

test("approval: the run waits, goes on with the choice and doesn't do twice what it did", async () => {
  const { w, s, e } = await world();
  const db = w.createPage({ kind: "database", title: `Bestellungen ${n}` });
  const f = s.createFlow({
    name: name("order"),
    permissions: { write: [db] },
    nodes: [
      { id: "draft", kind: "action", action: "db.insert", input: { database: String(db), title: "Entwurf" } },
      { id: "ok", kind: "approve", title: "Bestellen: {{ input.what }}?", options: ["yes", "no"] },
      { id: "decide", kind: "if", when: "steps.ok.choice == 'yes'", then: [{ id: "final", kind: "action", action: "db.insert", input: { database: String(db), title: "Bestellt" } }], else: [] },
    ],
    output: "{{ steps.ok.choice }}",
  });
  const r = await e.runFlow(f, { what: "Milch" });
  assert.equal(r.status, "waiting");
  assert.equal(r.waiting?.title, "Bestellen: Milch?");
  assert.equal(s.waitingRuns().some((x) => x.id === r.runId), true);
  assert.equal(w.rowsOf(db)!.rows.length, 1);
  await assert.rejects(() => e.resumeFlowRun(r.runId, { choice: "maybe" }), /one of/);
  const done = await e.resumeFlowRun(r.runId, { choice: "yes" });
  assert.equal(done.status, "done");
  assert.equal(done.output, "yes");
  assert.deepEqual(w.rowsOf(db)!.rows.map((x) => x.title).sort(), ["Bestellt", "Entwurf"], "the draft was not made twice");
});

test("a wait goes on when its time has come (the scheduler)", async () => {
  const { s, e } = await world();
  const f = s.createFlow({ name: name("later"), nodes: [{ id: "w", kind: "wait", minutes: 30 }, { id: "x", kind: "set", vars: { at: "after" } }], output: "{{ vars.at }}" });
  const r = await e.runFlow(f);
  assert.equal(r.status, "waiting");
  assert.equal(await e.resumeDueFlows(new Date()), 0, "not yet");
  assert.equal(await e.resumeDueFlows(new Date(Date.now() + 31 * 60000)), 1);
  const run = s.getFlowRun(r.runId)!;
  assert.equal(run.status, "waiting", "Date.now() itself hasn't moved: the wait holds until it has");
});

test("try/catch, onError=continue and the step budget", async () => {
  const { s, e } = await world();
  const f = s.createFlow({
    name: name("errors"),
    nodes: [
      { id: "t", kind: "try", nodes: [{ id: "bad", kind: "fail", message: "kaputt {{ input.x }}" }], catch: [{ id: "c", kind: "set", vars: { caught: "{{ error.message }}" } }] },
      { id: "soft", kind: "action", action: "lookup.details", input: { source: "nosuch", id: "1" }, onError: "continue" },
    ],
    output: { caught: "{{ vars.caught }}", soft: "{{ steps.soft.error }}" },
  });
  const r = await e.runFlow(f, { x: 1 });
  assert.equal(r.status, "done", r.error ?? "");
  assert.equal((r.output as { caught: string }).caught, "kaputt 1");
  assert.match((r.output as { soft: string }).soft, /no lookup source/);
  const loop = s.createFlow({ name: name("budget"), permissions: { maxSteps: 20 }, nodes: [{ id: "l", kind: "foreach", items: "input.xs", nodes: [{ id: "s", kind: "set", vars: { a: 1 } }] }] });
  assert.match((await e.runFlow(loop, { xs: Array.from({ length: 50 }, (_, i) => i) })).error!, /more than 20 steps/);
});

test("a flow can be a lookup source (a web recipe)", async () => {
  const { s } = await world();
  s.createFlow({
    name: name("recipe"),
    lookup: { label: "Demo", what: "finds demo things", fields: { year: "the year" } },
    nodes: [
      { id: "m", kind: "switch", on: "input.mode", cases: [{ value: "search", nodes: [{ id: "r1", kind: "return", value: [{ id: "a1", title: "{{ input.query }} (1999)" }] }] }, { value: "details", nodes: [{ id: "r2", kind: "return", value: { title: "A", year: 1999 } }] }], default: [] },
    ],
  });
  const { lookupSources, searchLookup } = await import("@/plugins/workspace/lookups");
  const src = lookupSources().find((x) => x.id === `flow.recipe.t${n}`);
  assert.ok(src, "listed with the other sources");
  const r = await searchLookup(src!.id, "Matrix", "de-DE", true);
  assert.deepEqual(r.hits.map((h) => h.title), ["Matrix (1999)"]);
  assert.deepEqual(await src!.details("a1", "de-DE"), { title: "A", year: 1999 });
});

test("checks: unknown actions, missing inputs, broken expressions are named", async () => {
  const { checkFlow } = await import("@/plugins/workspace/flows/check");
  const { normalizeFlow } = await import("@/plugins/workspace/flows/types");
  const problems = checkFlow(normalizeFlow({ name: "bad.one", nodes: [{ id: "a", kind: "action", action: "nope", input: {} }, { id: "b", kind: "action", action: "http.request", input: {} }, { id: "c", kind: "set", vars: { x: "{{ input.q | nosuch }}" } }] }));
  assert.equal(problems.length, 3, problems.join("\n"));
  assert.throws(() => normalizeFlow({ name: "Bad Name", nodes: [] }), /lowercase/);
});

test("a lifecycle: transitions with guards and required fields, a strict field, the history, the enter flow", async () => {
  const { w, s } = await world();
  const { newProperty, newId } = await import("@/plugins/workspace/model");
  const opts = ["Draft", "Submitted", "Approved", "Paid"].map((name) => ({ id: newId("o"), name, color: "gray" }));
  const status = { ...newProperty("Status", "select"), options: opts };
  const amount = newProperty("Amount", "number");
  const approver = newProperty("Approver", "text");
  const db = w.createPage({ kind: "database", title: `Ausgaben ${n}` });
  const [draft, submitted, approved, paid] = opts.map((o) => o.id);
  const entered: unknown[] = [];
  s.createFlow({ name: name("on.approved"), nodes: [{ id: "x", kind: "script", code: "return row.title;", input: {} }] });
  const enterFlow = `on.approved.t${n}`;
  const schema = w.getDatabase(db)!.schema;
  w.updateSchema(db, {
    ...schema,
    properties: [status, amount, approver],
    lifecycle: {
      field: status.id,
      strict: true,
      enter: { [approved]: enterFlow },
      transitions: [
        { id: "submit", name: "Submit", from: [draft], to: submitted, require: [amount.id] },
        { id: "approve", name: "Approve", from: [submitted], to: approved, guard: "row.Amount < 1000", require: [approver.id] },
        { id: "pay", name: "Pay", from: [approved], to: paid },
      ],
    },
  });
  assert.ok(w.getDatabase(db)!.schema.lifecycle, "kept by the schema");
  const row = w.addRow(db, { title: "Laptop" });
  w.setCell(row, status.id, draft);
  const { takeTransition, transitionsOf, rowHistory } = await import("@/plugins/workspace/flows/lifecycle");
  await assert.rejects(() => takeTransition(row, "Submit"), /Amount must be filled/);
  w.setCell(row, amount.id, 1500);
  await takeTransition(row, "Submit");
  assert.throws(() => w.setCell(row, status.id, paid), /no way from Submitted to Paid/, "strict: no jumping");
  w.setCell(row, approver.id, "Anna");
  const shown = transitionsOf(w.getDatabase(db)!.schema, w.rowsOf(db)!.rows.find((r) => r.id === row)!);
  assert.equal(shown.find((t) => t.name === "Approve")?.ok, false, "the guard holds it back");
  w.setCell(row, amount.id, 800);
  // A card dragged into Approved: the fitting transition is taken.
  w.setCell(row, status.id, approved);
  assert.deepEqual(rowHistory(row).map((h) => h.transition), ["approve", "submit", null]);
  await new Promise((res) => setTimeout(res, 300));
  const runs = s.flowRuns(s.flowByName(enterFlow)!.pageId);
  entered.push(...runs.map((r) => r.output));
  assert.deepEqual(entered, ["Laptop"], "the enter flow ran with the row");
});

test("a view: run= buttons and <data> are checked and drawn; data.<name> reads what a flow gave", async () => {
  const { renderView } = await import("@/plugins/workspace/view-template");
  const base = { rows: [], props: [], titleName: "Name", state: {}, app: {}, db: { id: 1, title: "X" } };
  const r = renderView('<data name="films" flow="movie.search" with="q={{ state.q }}"/><button run="movie.save" with="id=7" into="saved" label="Save"/>{{#each data.films.hits}}<b>{{ title }}</b>{{/each}}{{ data.films_status }}', { ...base, data: { films: { hits: [{ title: "Dune" }] }, films_status: "ok" } });
  assert.deepEqual(r.errors, []);
  const flat = JSON.stringify(r.nodes);
  assert.ok(flat.includes('"t":"data"') && flat.includes('"action":"run"') && flat.includes("Dune") && flat.includes("ok"));
  const bad = renderView('<button run="x" action="new"/><data flow="y"/><transitions/>', base);
  assert.equal(bad.errors.length, 3, JSON.stringify(bad.errors));
  const { parseWith } = await import("@/plugins/workspace/flows/with");
  assert.deepEqual(parseWith("q=Dune, Arrakis, n=5"), { q: "Dune, Arrakis", n: "5" });
  assert.deepEqual(parseWith('{"a": [1]}'), { a: [1] });
});

test("the Studio's tree: a node inserted into a branch, moved, removed; what a node can read", async () => {
  const tr = await import("@/plugins/studio/tree");
  const { normalizeFlow } = await import("@/plugins/workspace/flows/types");
  const def = normalizeFlow({ name: "tree.test", inputs: [{ name: "q", type: "text" }], nodes: [{ id: "fetch", kind: "action", action: "web.read", input: {} }, { id: "loop", kind: "foreach", items: "steps.fetch.links", nodes: [] }] });
  const added = tr.newNode(def.nodes, "action", "ai.extract");
  assert.equal(added.id, "extract");
  let nodes = tr.insertNode(def.nodes, { parent: "loop", branch: "nodes" }, 0, added);
  assert.equal(tr.slotOf(nodes, "extract")?.slot.parent, "loop");
  const paths = tr.pathsBefore({ ...def, nodes }, "extract").map((p) => p.path);
  assert.ok(paths.includes("input.q") && paths.includes("steps.fetch") && paths.includes("item") && !paths.includes("steps.loop"), paths.join(", "));
  nodes = tr.insertNode(nodes, { parent: null, branch: "root" }, 0, tr.newNode(nodes, "set"));
  nodes = tr.moveNode(nodes, "set", 1);
  assert.deepEqual(nodes.map((n) => n.id), ["fetch", "set", "loop"]);
  nodes = tr.updateNode(nodes, "set", { label: "Merken" });
  assert.equal(tr.findNode(nodes, "set")?.label, "Merken");
  nodes = tr.removeNode(nodes, "extract");
  assert.equal(tr.findNode(nodes, "extract"), null);
  assert.equal(def.nodes.length, 2, "the original stays as it was");
});

test("the Studio's apps: each kind makes a database whose screen and detail page draw without errors, its flows checked", async () => {
  const { w, s } = await world();
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("lookups", true);
  const { createApp, APP_KINDS } = await import("@/plugins/studio/apps");
  const { renderView } = await import("@/plugins/workspace/view-template");
  const { viewAppMeta, DETAIL_PAGE } = await import("@/plugins/workspace/view-apps");
  const { checkFlow } = await import("@/plugins/workspace/flows/check");
  const { rowViewFor } = await import("@/plugins/workspace/row-views");
  for (const kind of APP_KINDS) {
    const made = createApp(kind, `App ${kind} ${n}`);
    const d = w.rowsOf(made.dbId)!;
    const screen = d.schema.views[0];
    assert.equal(screen.type, "app", kind);
    const meta = viewAppMeta("template")!;
    const r = renderView(screen.template!, { rows: d.rows, props: d.schema.properties, titleName: d.schema.titleName, state: { q: "x" }, app: {}, data: { hits: [{ title: "A", url: "https://a.example", snippet: "s" }] }, db: { id: made.dbId, title: "X" } }, { parts: meta.parts, actions: meta.actions });
    assert.deepEqual(r.errors, [], `${kind}: ${JSON.stringify(r.errors)}`);
    assert.ok(d.schema.rowTemplate, `${kind}: a detail page`);
    assert.equal(rowViewFor(d.schema)?.id, "detail");
    if (!d.rows.length) w.addRow(made.dbId, { title: "Probe" });
    const row = w.rowsOf(made.dbId)!.rows[0];
    const detail = renderView(d.schema.rowTemplate!, { rows: [row], props: d.schema.properties, titleName: d.schema.titleName, state: {}, app: {}, db: { id: made.dbId, title: "X" }, current: row }, { parts: DETAIL_PAGE.parts, actions: DETAIL_PAGE.actions });
    assert.deepEqual(detail.errors, [], `${kind} detail: ${JSON.stringify(detail.errors)}`);
    for (const f of made.flows) assert.deepEqual(checkFlow(s.flowByName(f)!), [], f);
    if (kind === "tracker") assert.ok(d.schema.lifecycle?.strict, "the tracker's items move along their lifecycle");
  }
  // The same name again: the flows get names of their own.
  const again = createApp("websearch", `App websearch ${n}`);
  assert.equal(new Set(again.flows).size, 2);
  assert.ok(again.flows.every((f) => /-2\./.test(f)), again.flows.join());
});
