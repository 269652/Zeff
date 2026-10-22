import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * A Workspace database in the knowledge brings each row with its fields — a journal's day: its date, mood, energy, tags and
 * what you are grateful for, then the thoughts on its page. Without the fields a diary's entry loses its day.
 */
test("knowledge: a Workspace row brings its fields (a journal entry: date, mood, energy …) and its page", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("workspace", true);
  setInstalled("knowledge", true);
  const w = await import("@/plugins/workspace/store");
  const m = await import("@/plugins/workspace/model");
  const { setCollection } = await import("@/lib/items");
  const { knowledgeDocs } = await import("@/plugins/knowledge/export");

  const date = m.newProperty("Datum", "date");
  const mood = { ...m.newProperty("Stimmung", "select"), options: [{ id: "o1", name: "Gut", color: "blue" }] };
  const energy = m.newProperty("Energie", "number");
  const grateful = m.newProperty("Dankbar für", "text");
  const empty = m.newProperty("Leer", "text");
  const tags = { ...m.newProperty("Tags", "multi_select"), options: [{ id: "t1", name: "Familie", color: "green" }] };
  const db = w.createPage({ kind: "database", title: "Journal-Einträge", icon: "✍️", schema: { titleName: "Überschrift", properties: [date, mood, energy, tags, grateful, empty], views: [m.newView("Table")] } });
  const row = w.addRow(db, { title: "Ein ruhiger Tag", cells: { [date.id]: "2026-10-21", [mood.id]: "o1", [energy.id]: 4, [tags.id]: ["t1"], [grateful.id]: "Kaffee am Morgen" } });
  w.updatePage(row, { content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Lange gelesen." }] }] } });

  assert.ok(!knowledgeDocs("http://zeff").docs.some((d) => d.id === `page:${row}`), "not in the knowledge until switched in");
  setCollection(`workspace:${db}`, { knowledge: true });
  const doc = knowledgeDocs("http://zeff").docs.find((d) => d.id === `page:${row}`);
  assert.ok(doc, "switched in: its rows are documents");
  assert.equal(doc.space, "✍️ Journal-Einträge");
  assert.equal(doc.title, "Ein ruhiger Tag");
  assert.equal(doc.body, "Eintrag in „✍️ Journal-Einträge“\nDatum: 2026-10-21\nStimmung: Gut\nEnergie: 4\nTags: Familie\nDankbar für: Kaffee am Morgen\n\nLange gelesen.");
});
