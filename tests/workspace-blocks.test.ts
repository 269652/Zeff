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

test("the figure block: a count, a sum, a share - over all rows or the filter of a view", async () => {
  const { id, openView, amount } = await setup();
  const { metricData } = await import("@/plugins/workspace/blocks");
  assert.equal(metricData({ dbId: id, calc: "count" }).value, 4);
  assert.equal(metricData({ dbId: id, viewId: openView, calc: "count" }).value, 2, "the filter of the view");
  assert.equal(metricData({ dbId: id, calc: "sum", prop: amount }).value, 475);
  assert.equal(metricData({ dbId: id, viewId: openView, calc: "sum", prop: amount }).value, 75);
  assert.equal(metricData({ dbId: id, calc: "avg", prop: amount }).value, 118.75);
  assert.equal(metricData({ dbId: id, viewId: openView, calc: "share" }).text, "50 %");
  assert.match(metricData({ dbId: id, calc: "sum", prop: amount }).text, /475,00 €/, "formatted as the field is");
});

test("the chart block: by a choice, by month of a date, sums", async () => {
  const { id, status, closed, amount } = await setup();
  const { chartData } = await import("@/plugins/workspace/blocks");
  const byStatus = chartData({ dbId: id, type: "bar", groupBy: status, calc: "count" });
  assert.deepEqual(byStatus.points.map((p) => [p.label, p.value]), [["Not started", 1], ["In progress", 1], ["Done", 2]]);
  const byMonth = chartData({ dbId: id, type: "column", groupBy: closed, calc: "sum", prop: amount, bucket: "month" });
  assert.deepEqual(byMonth.points.map((p) => [p.label, p.value]), [["2026-01", 400], ["2026-02", 50], ["2026-03", 25]]);
  assert.equal(byMonth.unit, "€");
  assert.throws(() => chartData({ dbId: id, type: "bar", groupBy: "nope", calc: "count" }), /group/i);
});

test("the appointments, todos and document blocks read what Zeff holds", async () => {
  await setup();
  const ir = await import("@/lib/calendar/ir");
  const { dayOf } = await import("@/lib/calendar/ir-shared");
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const day = dayOf(tomorrow);
  ir.addEvent(ir.zeffCalendar().id, { title: "Kickoff", start: `${day}T10:00`, end: `${day}T11:00`, allDay: false, location: "Room 4" });
  ir.addEvent(ir.zeffCalendar().id, { title: "Dentist", start: `${day}T15:00`, end: `${day}T16:00`, allDay: false });
  const b = await import("@/plugins/workspace/blocks");
  const mine = ir.zeffCalendar().name;
  assert.deepEqual((await b.eventsData({ days: 7, calendar: mine })).events.map((e) => e.title), ["Kickoff", "Dentist"]);
  assert.deepEqual((await b.eventsData({ days: 7, q: "room", calendar: mine })).events.map((e) => e.title), ["Kickoff"], "by words");
  const { addFollowUp, getTodo } = await import("@/lib/boards/store");
  const a = addFollowUp({ ticket: "ABC-1", text: "Write the offer", kind: "other", parentId: null as unknown as number, workRunId: null, source: "test" });
  addFollowUp({ ticket: "XYZ-2", text: "Call the bank", kind: "other", parentId: null as unknown as number, workRunId: null, source: "test" });
  assert.deepEqual((await b.tasksData({ status: "open", ticket: "abc-1" })).tasks.map((x) => x.text), ["Write the offer"]);
  assert.equal((await b.tasksData({ status: "open", q: "bank" })).tasks.length, 1);
  await b.setTaskDone(a.id, true);
  assert.equal(getTodo(a.id)!.status, "done");
  assert.equal((await b.tasksData({ status: "open", ticket: "ABC-1" })).tasks.length, 0);
  const { addDocument } = await import("@/plugins/documents/store");
  const doc = addDocument("offer.txt", Buffer.from("Angebot")).doc;
  const d = await b.documentData({ docId: doc.id });
  assert.equal(d.name, "offer.txt");
  await assert.rejects(() => b.documentData({ docId: 9999 }), /gone/);
});

test("data blocks in a page's Markdown: one line each, written back they are the same block, strange values are cleaned", async () => {
  const { markdownToDoc, docToMarkdown, sanitizeDoc } = await import("@/plugins/workspace/doc");
  const md = ':::block metric {"dbId":12,"calc":"sum","prop":"p1","label":"Revenue","style":"progress"}\n\n:::block chart {"dbId":12,"type":"pie","groupBy":"p2","calc":"count","bucket":"month","limit":12}\n\n:::block events {"days":14,"q":"review"}\n\n:::block tasks {"status":"open","ticket":"PROJ-1"}\n\n:::block document {"docId":5}\n\n:::block people {"ids":[1,2]}\n';
  const doc = markdownToDoc(md);
  assert.deepEqual(doc.content.map((n) => n.type), ["zeffMetric", "zeffChart", "zeffEvents", "zeffTasks", "zeffDocument", "zeffPeople"]);
  assert.equal(doc.content[0].attrs!.dbId, 12);
  const out = docToMarkdown(doc);
  assert.equal(docToMarkdown(markdownToDoc(out)), out);
  const clean = sanitizeDoc({ type: "doc", content: [{ type: "zeffChart", attrs: { dbId: "7", limit: -4, title: "x".repeat(500), evil: "<script>" } }, { type: "zeffPeople", attrs: { ids: [1, 2, -3] } }] });
  const [chart, people] = clean.content;
  assert.equal(chart.attrs!.dbId, 7);
  assert.equal(chart.attrs!.limit, undefined);
  assert.equal(String(chart.attrs!.title).length, 200);
  assert.equal("evil" in chart.attrs!, false);
  assert.deepEqual(people.attrs!.ids, [1, 2]);
});
