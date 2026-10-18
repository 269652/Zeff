import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * Notes and Keep are two plugins: Notes is the note boards in the Workspace (works alone, on by default), Google Keep only the sync
 * with Google's notes (needs Notes). "New → Keep board" comes from Notes and makes a Workspace database like a Keep board.
 */
test("Keep builds on Notes; Notes is on without Keep", async () => {
  const { pluginById } = await import("@/plugins/catalog");
  const { isInstalled, setInstalled } = await import("@/plugins/state");
  assert.equal(pluginById("notes").defaultInstalled, true);
  assert.deepEqual(pluginById("keep").dependsOn, ["notes"]);
  assert.equal(pluginById("keep").extensions, undefined, "the extensions are Notes'");
  assert.ok(pluginById("notes").extensions!.some((e) => e.key === "note-review"));
  setInstalled("workspace", true);
  assert.equal(isInstalled("notes"), true);
  assert.equal(isInstalled("keep"), false, "Google Keep stays off until you install it");
});

test("New → template → Keep board: a Workspace database with the note-board layout, without the Keep plugin", async () => {
  const { setInstalled, isInstalled } = await import("@/plugins/state");
  setInstalled("workspace", true);
  setInstalled("keep", false);
  assert.equal(isInstalled("keep"), false);
  const { templateMetas, fromTemplate } = await import("@/plugins/workspace/templates");
  const meta = templateMetas().find((m) => m.key === "keep-board");
  assert.ok(meta, "the template is offered");
  assert.equal(meta.kind, "database");

  const w = await import("@/plugins/workspace/store");
  const parent = w.createPage({ title: "Home" });
  const id = fromTemplate("keep-board", parent);
  const d = w.getDatabase(id)!;
  assert.equal(d.page.title, "Keep board");
  assert.equal(d.page.parentId, parent);
  assert.deepEqual(d.schema.views.map((v) => v.type), ["gallery", "table"]);
  assert.deepEqual(d.schema.properties.map((p) => p.name), ["Color", "Pinned", "Labels", "Note"]);
  assert.ok(d.schema.properties[0].options!.some((o) => o.name === "yellow"));
});

test("with Notes off, own boards are not in the briefing", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("keep", false);
  setInstalled("notes", false);
  const { notesInLage } = await import("@/plugins/keep/lage");
  assert.equal(notesInLage(), false);
  setInstalled("notes", true);
});
