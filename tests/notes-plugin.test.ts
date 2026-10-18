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

test("New → Keep board: a Workspace database with the note-board layout, without the Keep plugin", async () => {
  const { setInstalled, isInstalled } = await import("@/plugins/state");
  setInstalled("workspace", true);
  setInstalled("keep", false);
  assert.equal(isInstalled("keep"), false);
  const { newItems } = await import("@/plugins/workspace/new-items-point");
  await import("@/plugins/contributions");
  const entry = newItems.list().find((c) => c.plugin === "notes");
  assert.ok(entry, "Notes offers a new item");
  assert.equal(entry.impl.id, "keep-board");
  assert.equal(entry.impl.label, "Keep board");

  const w = await import("@/plugins/workspace/store");
  const parent = w.createPage({ title: "Home" });
  const id = entry.impl.create(parent);
  const d = w.getDatabase(id)!;
  assert.equal(d.page.title, "Keep board");
  assert.equal(d.page.parentId, parent);
  assert.deepEqual(d.schema.views.map((v) => v.type), ["gallery", "table"]);
  assert.deepEqual(d.schema.properties.map((p) => p.name), ["Color", "Pinned", "Labels", "Note"]);
  assert.ok(d.schema.properties[0].options!.some((o) => o.name === "yellow"));

  const { createNewItemAction, newItemsAction } = await import("@/plugins/workspace/actions");
  const list = await newItemsAction();
  assert.ok(list.ok && list.items.some((i) => i.key === "notes:keep-board"));
  const made = await createNewItemAction("notes:keep-board", null);
  assert.ok(made.ok && w.getDatabase(made.id));
  const bad = await createNewItemAction("nope:x", null);
  assert.equal(bad.ok, false);
});

test("with Notes off, no new item and own boards are not offered", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("keep", false);
  setInstalled("notes", false);
  const { newItems } = await import("@/plugins/workspace/new-items-point");
  assert.ok(!newItems.list().some((c) => c.plugin === "notes"));
  const { notesInLage } = await import("@/plugins/keep/lage");
  assert.equal(notesInLage(), false);
  setInstalled("notes", true);
});
