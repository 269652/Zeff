import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const setup = async () => {
  const st = await import("@/plugins/state");
  for (const id of ["workspace", "calendar", "todos", "documents"] as const) st.setInstalled(id, true);
  const store = await import("@/plugins/workspace/store");
  const { applyOps } = await import("@/plugins/workspace/schema-ops");
  const id = store.createPage({ kind: "database", title: "Deals" });
  const { schema } = applyOps(
    store.getDatabase(id)!.schema,
    [
      { op: "remove_property", property: "Date" },
      { op: "add_property", name: "Amount", type: "number", format: "euro" },
      { op: "add_property", name: "Closed", type: "date" },
      { op: "update_view", view: "Table", name: "Table" },
      { op: "add_view", name: "Open", type: "table", filter: [{ property: "Status", cond: "is_not", value: "Done" }] },
    ],
    { related: () => null },
  );
  store.saveSchema(id, schema);
  const { valuesToCells } = await import("@/plugins/workspace/mcp-db");
  let live = store.getDatabase(id)!.schema;
  const rows = [
    ["A", "Done", 100, "2026-01-05"],
    ["B", "Done", 300, "2026-01-20"],
    ["C", "In progress", 50, "2026-02-03"],
    ["D", "Not started", 25, "2026-03-09"],
  ] as const;
  for (const [title, status, amount, closed] of rows) {
    const c = await valuesToCells(live, { Status: status, Amount: amount, Closed: closed });
    if (c.schema !== live) live = store.updateSchema(id, c.schema);
    store.addRow(id, { title, cells: c.cells });
  }
  return { id, store, openView: store.getDatabase(id)!.schema.views.find((v) => v.name === "Open")!.id, amount: live.properties.find((p) => p.name === "Amount")!.id, status: live.properties.find((p) => p.name === "Status")!.id, closed: live.properties.find((p) => p.name === "Closed")!.id };
};

test("the old figure blocks become Kennzahlen: a count, a sum, a share - over all rows or the filter of a view", async () => {
  const { id, openView, amount } = await setup();
  const { defineBlockMetric } = await import("@/plugins/workspace/data-block-migration");
  const { metricValue } = await import("@/plugins/workspace/metrics");
  const value = async (spec: Parameters<typeof defineBlockMetric>[0]) => metricValue((await defineBlockMetric(spec))!).value;
  assert.equal(await value({ dbId: id, viewId: "", calc: "count", prop: "", label: "" }), 4);
  assert.equal(await value({ dbId: id, viewId: openView, calc: "count", prop: "", label: "" }), 2, "the filter of the view");
  assert.equal(await value({ dbId: id, viewId: "", calc: "sum", prop: amount, label: "Revenue" }), 475);
  assert.equal(await value({ dbId: id, viewId: openView, calc: "sum", prop: amount, label: "" }), 75);
  assert.equal(await value({ dbId: id, viewId: "", calc: "avg", prop: amount, label: "" }), 118.75);
  assert.equal(await value({ dbId: id, viewId: openView, calc: "share", prop: "", label: "Open share" }), 50);
  assert.equal(await defineBlockMetric({ dbId: id, viewId: "", calc: "sum", prop: amount, label: "Revenue" }), "Revenue", "the same one again is taken");
  assert.equal(await defineBlockMetric({ dbId: id, viewId: openView, calc: "sum", prop: amount, label: "Revenue" }), "Revenue (2)", "another of that name: a name of its own");
  assert.equal(await defineBlockMetric({ dbId: 99999, viewId: "", calc: "count", prop: "", label: "" }), null);
});

test("old data blocks (a version from before): read as widgets, a chart view to make, the document's link; the chart marker settled once", async () => {
  const { id, store, status } = await setup();
  const { sanitizeDoc, markdownToDoc } = await import("@/plugins/workspace/doc");
  const old = {
    type: "doc",
    content: [
      { type: "zeffMetric", attrs: { dbId: id, calc: "count", label: "Deals", style: "number" } },
      { type: "zeffChart", attrs: { dbId: id, type: "pie", groupBy: status, calc: "count", title: "By status" } },
      { type: "zeffEvents", attrs: { days: 14, q: "review", limit: 5 } },
      { type: "zeffTasks", attrs: { status: "open", ticket: "PROJ-1", limit: 4 } },
      { type: "zeffDocument", attrs: { docId: 7 } },
      { type: "zeffPeople", attrs: { ids: [1, 2] } },
    ],
  };
  const [metric, chart, events, tasks, document, people] = sanitizeDoc(old).content;
  assert.equal(metric.attrs!.widget, "workspace.metrics");
  assert.match(String(JSON.parse(String(metric.attrs!.config)).define), /"label":"Deals"/, "a Kennzahl to define, where it is shown");
  assert.equal(chart.type, "databaseView");
  assert.match(String(chart.attrs!.viewId), /^chart~pie~/);
  assert.deepEqual([events.attrs!.widget, JSON.parse(String(events.attrs!.config))], ["calendar.agenda", { days: 14, q: "review", limit: 5 }]);
  assert.deepEqual([tasks.attrs!.widget, JSON.parse(String(tasks.attrs!.config))], ["todos.list", { ticket: "PROJ-1", status: "open", limit: 4 }]);
  assert.equal(document.type, "paragraph", "a link to the document");
  assert.match(JSON.stringify(document), /\/documents\?doc=7/);
  assert.deepEqual([people.attrs!.widget, JSON.parse(String(people.attrs!.config)).ids], ["people.list", "1,2"]);
  const { parseChartMarker } = await import("@/plugins/workspace/legacy-blocks");
  const { ensureChartView } = await import("@/plugins/workspace/data-block-migration");
  const spec = parseChartMarker(String(chart.attrs!.viewId))!;
  const viewId = ensureChartView(id, spec, "By status")!;
  const view = store.getDatabase(id)!.schema.views.find((v) => v.id === viewId)!;
  assert.deepEqual([view.type, view.chartKind, view.groupBy, view.name], ["chart", "pie", status, "By status"]);
  const views = store.getDatabase(id)!.schema.views.length;
  assert.equal(ensureChartView(id, spec), viewId, "the same chart view is taken");
  assert.equal(store.getDatabase(id)!.schema.views.length, views);
  assert.equal(markdownToDoc(':::block metric {"dbId":12}').content[0].type, "paragraph", "the old blocks are no Markdown");
});

test("widgets and chart views in Markdown: written back the same", async () => {
  const { markdownToDoc, docToMarkdown } = await import("@/plugins/workspace/doc");
  const md = ':::widget calendar.agenda {"config":{"days":14,"q":"review","limit":8}}\n\n:::database 12 @chart~pie~p2~count~~\n';
  const out = docToMarkdown(markdownToDoc(md));
  assert.match(out, /:::widget calendar\.agenda \{"config":\{"days":14,"q":"review","limit":8\}\}/);
  assert.match(out, /:::database 12 @chart~pie~p2~count~~/);
  assert.equal(docToMarkdown(markdownToDoc(out)), out);
});

test("the widgets that took the old blocks' places: todos of a ticket or by words, ticked off in place", async () => {
  await setup();
  const { addFollowUp, getTodo } = await import("@/lib/todos/store");
  const a = addFollowUp({ ticket: "ABC-1", text: "Write the offer", kind: "other", parentId: null as unknown as number, workRunId: null, source: "test" });
  addFollowUp({ ticket: "XYZ-2", text: "Call the bank", kind: "other", parentId: null as unknown as number, workRunId: null, source: "test" });
  const { TODOS_WIDGETS } = await import("@/plugins/todos/widgets");
  const w = TODOS_WIDGETS.find((x) => x.id === "todos.list")!;
  const items = async (config: Record<string, string | number>) => {
    const d = await w.data({ status: "open", limit: 10, q: "", ticket: "", ...config });
    return d.kind === "list" ? d.items.map((x) => x.text) : [];
  };
  assert.deepEqual(await items({ ticket: "abc-1" }), ["Write the offer"]);
  assert.deepEqual(await items({ q: "bank" }), ["Call the bank"]);
  await w.act!("toggle", { id: String(a.id) }, {});
  assert.equal(getTodo(a.id)!.status, "done");
  assert.deepEqual(await items({ ticket: "ABC-1" }), []);
});

test("the activity of a row: who changed what - you, the AI, a source - and the text edited once, not per keystroke", async () => {
  const store = await import("@/plugins/workspace/store");
  const { activityOf } = await import("@/plugins/workspace/activity");
  const { asAgent } = await import("@/plugins/workspace/agent-scope");
  const { quietly } = await import("@/plugins/workspace/events");
  const { newProperty } = await import("@/plugins/workspace/model");
  const id = store.createPage({ kind: "database", title: "Log", schema: { titleName: "Name", properties: [{ ...newProperty("Note", "text") }], views: [] } });
  const note = store.getDatabase(id)!.schema.properties[0].id;
  const row = store.addRow(id, { title: "First" });
  store.setCell(row, note, "hello");
  asAgent(() => store.setCell(row, note, "hello world"))();
  quietly(() => store.setCell(row, note, "from the source"));
  store.updatePage(row, { title: "Second" });
  store.setCell(row, note, "from the source"); // no change: nothing told
  store.updatePage(row, { content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }] } });
  store.updatePage(row, { content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "ab" }] }] } });
  const lines = activityOf(row, 20).reverse();
  assert.deepEqual(lines.map((l) => [l.actor, l.field]), [["you", "created"], ["you", "Note"], ["ai", "Note"], ["source", "Note"], ["you", "title"], ["you", "text"]]);
  assert.deepEqual([lines[1].from, lines[1].to], ["", "hello"]);
  assert.deepEqual([lines[4].from, lines[4].to], ["First", "Second"]);
});

test("everything that belongs: pages it links to and that link to it, related rows both ways, todos and tickets it names", async () => {
  const store = await import("@/plugins/workspace/store");
  const { belongsTo } = await import("@/plugins/workspace/belongs");
  const { markdownToDoc } = await import("@/plugins/workspace/doc");
  const { addFollowUp } = await import("@/lib/todos/store");
  const todo = addFollowUp({ ticket: "ABC-7", text: "Send the quote", kind: "other", parentId: null as unknown as number, workRunId: null, source: "test" });
  const other = store.createPage({ title: "Roadmap" });
  const back = store.createPage({ title: "Meeting notes", content: markdownToDoc("See [[page:" + other + "|Roadmap]] too") });
  const page = store.createPage({ title: "Quarterly planning", content: markdownToDoc(`Plan with [[page:${other}|Roadmap]], the todo [[todo:${todo.id}]] and [[ticket:ABC-7]].`) });
  store.updatePage(other, { content: markdownToDoc(`Mentioned in [[page:${page}|Quarterly planning]]`) });
  const b = await belongsTo(page);
  const titles = (key: string) => b.groups.find((g) => g.key === key)?.items.map((x) => x.title) ?? [];
  assert.deepEqual(titles("linked"), ["Roadmap"]);
  assert.deepEqual(titles("linking"), ["Roadmap"].filter(() => false), "a page already listed is not listed twice");
  assert.deepEqual(b.todos.map((x) => x.text), ["Send the quote"]);
  assert.deepEqual(b.tickets.map((x) => x.key), ["ABC-7"]);
  const r = await belongsTo(other);
  assert.ok(r.groups.some((g) => g.items.some((x) => x.id === page)), "the page it is linked with, listed once");
  assert.ok(r.groups.some((g) => g.key === "linking" && g.items.some((x) => x.id === back)), "a page that only links here");
  assert.ok(back > 0);
});

test("tabs in a page's Markdown: :::tabs with :::tab inside, both ways", async () => {
  const { markdownToDoc, docToMarkdown, sanitizeDoc } = await import("@/plugins/workspace/doc");
  const md = ":::tabs\n:::tab Overview\nText of the overview\n:::\n:::tab Details\n- a\n- b\n:::\n:::\n\n:::block activity {\"limit\":5}\n\n:::block belongs\n";
  const doc = markdownToDoc(md);
  assert.deepEqual(doc.content.map((n) => n.type), ["zeffTabs", "zeffActivity", "zeffBelongs"]);
  assert.deepEqual(doc.content[0].content!.map((x) => [x.type, x.attrs!.title]), [["zeffTab", "Overview"], ["zeffTab", "Details"]]);
  const out = docToMarkdown(doc);
  assert.equal(docToMarkdown(markdownToDoc(out)), out);
  const clean = sanitizeDoc({ type: "doc", content: [{ type: "zeffTabs", attrs: { active: "x" }, content: [{ type: "zeffTab", attrs: { title: "   " }, content: [{ type: "paragraph" }] }] }] });
  assert.equal(clean.content[0].attrs!.active, 0);
  assert.equal(clean.content[0].content![0].attrs!.title, "Tab");
});
