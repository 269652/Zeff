import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

test("a row made with New and closed again untouched goes (to the bin) — one written in, named or changed stays", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("workspace", true);
  const w = await import("@/plugins/workspace/store");
  const { newProperty, newView } = await import("@/plugins/workspace/model");
  const date = { ...newProperty("Date", "date"), defaultToday: true };
  const mood = newProperty("Mood", "text");
  const db = w.createPage({ title: "Journal", kind: "database", schema: { titleName: "Name", properties: [date, mood], views: [newView("T")] } });
  const { discardIfUntouched } = await import("@/plugins/workspace/fresh-rows");

  const empty = w.addRow(db, {});
  assert.equal(discardIfUntouched(empty, []), true, "only today's date (its default): untouched");
  assert.ok(w.getPage(empty)?.archivedAt, "in the bin");

  const fromDay = w.addRow(db, { cells: { [date.id]: "2026-10-20" } });
  assert.equal(discardIfUntouched(fromDay, [date.id]), true, "only what it was made with");

  const named = w.addRow(db, {});
  w.updatePage(named, { title: "First day" });
  assert.equal(discardIfUntouched(named, []), false);
  assert.ok(!w.getPage(named)?.archivedAt);

  const filled = w.addRow(db, {});
  w.setCell(filled, mood.id, "good");
  assert.equal(discardIfUntouched(filled, []), false, "a value of its own");

  const written = w.addRow(db, {});
  w.updatePage(written, { content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Heute…" }] }] } as never });
  assert.equal(discardIfUntouched(written, []), false, "its page written in");

  assert.equal(discardIfUntouched(99999, []), false, "gone already: nothing");
});
