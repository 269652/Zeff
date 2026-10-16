import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

/**
 * A column's content type, chosen from the table's header: text, Markdown, link, date, formula … A Markdown column holds
 * formatted text (kept as typed); changing a column's type keeps what its cells hold where it still fits, and a type with
 * choices (select, status) starts with some.
 */
setupTempData();

test("a Markdown column keeps its text as typed and survives a save", async () => {
  const w = await import("@/plugins/workspace/store");
  const m = await import("@/plugins/workspace/model");
  assert.ok((m.PROP_TYPES as readonly string[]).includes("markdown"));
  assert.equal(m.PROP_LABELS.markdown, "Markdown");
  const db = w.createPage({ kind: "database", title: "Notes", schema: { titleName: "Name", properties: [{ id: "p_md", name: "Details", type: "markdown" }], views: [m.newView("Table")] } });
  const row = w.addRow(db, { title: "A" });
  w.setCell(row, "p_md", "# Heading\n\n- one\n- two");
  const back = w.rawRows(db)[0];
  assert.equal(back.cells.p_md, "# Heading\n\n- one\n- two");
  assert.equal(w.getDatabase(db)!.schema.properties[0].type, "markdown", "the type is kept by the schema");
  assert.equal(m.cellText(w.getDatabase(db)!.schema.properties[0], back.cells.p_md), "# Heading\n\n- one\n- two");
});

test("retype: the type changes, a type with choices starts with some, the rest stays", async () => {
  const { retype } = await import("@/plugins/workspace/model");
  const text = { id: "p_a", name: "A", type: "text" as const, aiPrompt: "x" };
  const md = retype(text, "markdown");
  assert.deepEqual([md.id, md.name, md.type], ["p_a", "A", "markdown"]);
  const status = retype(text, "status");
  assert.deepEqual(status.options?.map((o) => [o.name, o.group]), [["Not started", "todo"], ["In progress", "doing"], ["Done", "done"]]);
  const select = retype(text, "select");
  assert.deepEqual(select.options, []);
  const kept = retype({ ...status, type: "status" as const }, "select");
  assert.equal(kept.options?.length, 3, "choices already there stay");
});

test("a text column turned into a link or a Markdown column keeps its cells", async () => {
  const w = await import("@/plugins/workspace/store");
  const m = await import("@/plugins/workspace/model");
  const db = w.createPage({ kind: "database", title: "Links", schema: { titleName: "Name", properties: [{ id: "p_u", name: "Address", type: "text" }], views: [m.newView("Table")] } });
  const row = w.addRow(db, { title: "x", cells: { p_u: "https://example.org/" } });
  const cur = w.getDatabase(db)!.schema;
  w.updateSchema(db, { ...cur, properties: cur.properties.map((p) => m.retype(p, "url")) });
  assert.equal(w.rawRows(db).find((r) => r.id === row)!.cells.p_u, "https://example.org/");
});
