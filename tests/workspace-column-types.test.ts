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

test("an AI column with choices groups in the order of its choices, each with its colour", async () => {
  const m = await import("@/plugins/workspace/model");
  const env: import("@/plugins/workspace/model").Property = { id: "env", name: "Umgebung", type: "ai", aiChoices: ["Dev", "Test", "Prod"], aiColors: { Dev: "gray", Prod: "red" } };
  assert.equal(m.choiceColor(env, "Dev"), "gray");
  assert.equal(m.choiceColor(env, "Prod"), "red");
  assert.ok((m.COLORS as readonly string[]).includes(m.choiceColor(env, "Test")), "no colour set: one of the palette, by its place");
  assert.equal(m.choiceColor(env, "Something else"), "gray", "not a choice: grey");
  const row = (id: number, v: string | undefined) => ({ id, title: String(id), icon: "", cells: v ? { env: v } : {}, createdAt: "", updatedAt: "" });
  const groups = m.groupRows([row(1, "Prod"), row(2, "Dev"), row(3, "Prod"), row(4, undefined)], "env", [env]);
  assert.deepEqual(groups.map((g) => [g.label, g.rows.length, g.color]), [["Dev", 1, "gray"], ["Test", 0, m.choiceColor(env, "Test")], ["Prod", 2, "red"], ["No value", 1, undefined]], "choices in their order, empty ones too (a board's columns)");
});

test("aiColors survive a save", async () => {
  const m = await import("@/plugins/workspace/model");
  const s = m.normalizeSchema({ titleName: "N", properties: [{ id: "a", name: "A", type: "ai", aiChoices: ["x", "y"], aiColors: { x: "red", y: "nope" } }], views: [] });
  assert.deepEqual(s.properties[0].aiColors, { x: "red" }, "only colours of the palette");
});

test("column widths: kept to a sensible range, per column, removable; a fitted width follows the widest content", async () => {
  const m = await import("@/plugins/workspace/model");
  const v = m.newView("Table");
  const w = m.withWidths(v, { title: 300.4, p_a: 20, p_b: 99999, p_c: Number.NaN, p_d: 150 });
  assert.deepEqual(w.widths, { title: 300, p_a: m.WIDTH_MIN, p_b: m.WIDTH_MAX, p_d: 150 }, "rounded, clamped, nonsense dropped");
  assert.equal(m.withWidths(w, null).widths, undefined, "reset: the table sizes itself again");
  assert.equal(m.withWidths(w, {}).widths, undefined);
  assert.equal(m.fitWidth(120, 80), 122, "the content when it's wider than the head (+2 for the border)");
  assert.equal(m.fitWidth(40, 130), 132, "the head when that is wider");
  assert.equal(m.fitWidth(5000, 80), m.FIT_MAX, "not wider than a sensible maximum");
  assert.equal(m.fitWidth(10, 10), m.FIT_MIN, "not narrower than a sensible minimum");
});

test("column widths survive a save of the schema", async () => {
  const m = await import("@/plugins/workspace/model");
  const v = m.withWidths(m.newView("Table"), { title: 280 });
  const s = m.normalizeSchema({ titleName: "N", properties: [], views: [v] });
  assert.deepEqual(s.views[0].widths, { title: 280 });
});
