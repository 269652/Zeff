import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

test("an agent shapes a database by name: properties, a board and a calendar, columns with the title not first", async () => {
  const store = await import("@/plugins/workspace/store");
  const { applyOps } = await import("@/plugins/workspace/schema-ops");
  const { columnOrder, TITLE } = await import("@/plugins/workspace/model");
  const id = store.createPage({ title: "Films", kind: "database" });
  const base = store.getDatabase(id)!.schema;
  const { schema } = applyOps(
    base,
    [
      { op: "remove_property", property: "Date" },
      { op: "rename_title", name: "Film" },
      { op: "add_property", name: "Genre", type: "multi_select", options: ["Drama", { name: "Sci-Fi", color: "blue" }] },
      { op: "add_property", name: "Seen", type: "checkbox" },
      { op: "add_property", name: "Premiere", type: "date" },
      { op: "add_property", name: "Score", type: "number", format: "number" },
      { op: "add_property", name: "Double", type: "formula", formula: 'prop("Score") * 2' },
      { op: "add_view", name: "By status", type: "board" },
      { op: "add_view", name: "When", type: "calendar" },
      { op: "update_view", view: "Table", order: ["Seen", "title", "Genre"], sorts: [{ property: "Score", dir: "desc" }], filter: [{ property: "Status", cond: "is_not", value: "Done" }] },
    ],
    { related: () => null },
  );
  store.saveSchema(id, schema);
  const saved = store.getDatabase(id)!.schema;
  assert.equal(saved.titleName, "Film");
  assert.deepEqual(saved.properties.map((p) => p.name), ["Status", "Genre", "Seen", "Premiere", "Score", "Double"]);
  const board = saved.views.find((v) => v.name === "By status")!;
  assert.equal(board.groupBy, saved.properties.find((p) => p.name === "Status")!.id, "a board is grouped by the first status/select");
  assert.equal(saved.views.find((v) => v.name === "When")!.dateProp, saved.properties.find((p) => p.name === "Premiere")!.id);
  const table = saved.views.find((v) => v.name === "Table")!;
  const names = columnOrder(table, saved).map((c) => (c === TITLE ? "title" : saved.properties.find((p) => p.id === c)!.name));
  assert.deepEqual(names.slice(0, 3), ["Seen", "title", "Genre"], "the title column sits where the order puts it");
  const status = saved.properties.find((p) => p.name === "Status")!;
  assert.equal((table.filter.rules[0] as { value: string }).value, status.options!.find((o) => o.name === "Done")!.id, "a filter's option is told by name, kept by id");
  // All or nothing: a bad operation says which and changes nothing.
  assert.throws(() => applyOps(saved, [{ op: "add_property", name: "Ok", type: "text" }, { op: "update_view", view: "Nope" }], { related: () => null }), /No view "Nope"/);
});

test("values by name become cells: options are made, pages are found by title", async () => {
  const store = await import("@/plugins/workspace/store");
  const { valuesToCells } = await import("@/plugins/workspace/mcp-db");
  const { applyOps } = await import("@/plugins/workspace/schema-ops");
  const id = store.createPage({ title: "Books", kind: "database" });
  const { schema } = applyOps(store.getDatabase(id)!.schema, [{ op: "add_property", name: "Tags", type: "multi_select" }], { related: () => null });
  store.saveSchema(id, schema);
  const d = store.getDatabase(id)!;
  const c = await valuesToCells(d.schema, { Tags: ["new", "other"], Status: "Done", Nothing: 1 });
  assert.equal(Object.keys(c.cells).length, 2);
  assert.match(c.notes.join(), /no property "Nothing"/);
  assert.equal(c.schema.properties.find((p) => p.name === "Tags")!.options!.length, 2);
});

test("the page Markdown keeps callouts, toggles, database blocks and mentions both ways", async () => {
  const { markdownToDoc, docToMarkdown } = await import("@/plugins/workspace/doc");
  const md = "# Plan\n\nSee [[page:12|Roadmap]].\n\n:::callout 🚀 blue\nImportant **note**\n:::\n\n:::toggle More\nhidden\n:::\n\n:::database 7 Tasks\n";
  const doc = markdownToDoc(md);
  assert.deepEqual(doc.content.map((n) => n.type), ["heading", "paragraph", "callout", "details", "databaseView"]);
  const out = docToMarkdown(doc);
  assert.equal(docToMarkdown(markdownToDoc(out)), out);
  assert.match(out, /:::callout 🚀 blue/);
  assert.match(out, /\[\[page:12\|Roadmap\]\]/);
});

test("deleting a column drops the property, its values, the rollups through it and every view's memory of it", async () => {
  const store = await import("@/plugins/workspace/store");
  const { removeProperty } = await import("@/plugins/workspace/model");
  const id = store.createPage({ title: "Del", kind: "database" });
  const s0 = store.getDatabase(id)!.schema;
  const status = s0.properties.find((p) => p.name === "Status")!;
  store.saveSchema(id, { ...s0, views: s0.views.map((v) => ({ ...v, hidden: [status.id], groupBy: status.id, sorts: [{ prop: status.id, dir: "asc" as const }], order: ["title", status.id] })) });
  const rid = store.addRow(id, { title: "r", cells: { [status.id]: status.options![0].id } });
  store.saveSchema(id, removeProperty(store.getDatabase(id)!.schema, status.id));
  const d = store.getDatabase(id)!;
  assert.ok(!d.schema.properties.some((p) => p.id === status.id));
  const v = d.schema.views[0];
  assert.deepEqual([v.hidden, v.groupBy, v.sorts, v.order], [[], undefined, [], ["title"]]);
  assert.equal(store.getPage(rid)!.props[status.id], undefined, "its values are gone");
});

test("the assistant: a scripted AI makes a database, fills it, removes a column, and a bad call is reported back", async () => {
  const store = await import("@/plugins/workspace/store");
  const { workspaceChat } = await import("@/plugins/workspace/agent");
  (await import("@/plugins/state")).setInstalled("workspace", true);
  const prompts: string[] = [];
  const script = [
    { calls: [{ tool: "workspace_create_database", args: { title: "Assistant films", properties: [{ name: "Tags", type: "multi_select" }, { name: "Rating", type: "number" }], rows: [{ title: "Her", values: { Tags: ["Sci-Fi"], Rating: 5 } }] } }, { tool: "nonsense", args: {} }], reply: "" },
    { calls: [{ tool: "workspace_update_database", args: { database: "Assistant films", operations: [{ op: "remove_property", property: "Rating" }] } }], reply: "" },
    { calls: [], reply: "Done: made the database and removed Rating." },
  ];
  let i = 0;
  const r = await workspaceChat([{ role: "user", text: "Make a films database and drop the rating" }], undefined, async (p) => (prompts.push(p), script[i++]));
  assert.equal(r.reply, "Done: made the database and removed Rating.");
  assert.equal(r.changed, true);
  assert.deepEqual(r.steps.map((s) => [s.tool, s.ok]), [["workspace_create_database", true], ["nonsense", false], ["workspace_update_database", true]]);
  assert.match(prompts[1], /FEHLER: Kein Werkzeug „nonsense“/, "the failed call is told to the AI");
  assert.match(prompts[0], /### workspace_update_database[\s\S]*add_property/, "the tools are in the prompt");
  const db = store.tree().find((x) => x.title === "Assistant films")!;
  const d = store.getDatabase(db.id)!;
  assert.deepEqual(d.schema.properties.map((p) => p.name), ["Tags"]);
  assert.equal(store.rowsOf(db.id)!.rows.length, 1);
});
