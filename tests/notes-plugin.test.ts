import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * Notes are the Workspace's now (the Notes plugin went; what you had set for it, the Workspace keeps); Google Keep is a part of
 * the Workspace — only the sync with Google's notes, off until you install it.
 */
test("Keep is a part of the Workspace; the Workspace is on without Keep", async () => {
  const { pluginById } = await import("@/plugins/catalog");
  const { isInstalled, setInstalled } = await import("@/plugins/state");
  assert.equal(pluginById("notes"), undefined, "no plugin of its own");
  assert.equal(pluginById("workspace").defaultInstalled, true);
  assert.deepEqual(pluginById("keep").dependsOn, ["workspace"]);
  assert.equal(pluginById("keep").extensions, undefined, "the note extensions are the Workspace's");
  assert.ok(pluginById("workspace").extensions!.some((e) => e.key === "note-review"));
  setInstalled("workspace", true);
  assert.equal(isInstalled("keep"), false, "Google Keep stays off until you install it");
});

test("the ids of plugins that went, rewritten once: Kanban's and Notes' choice the Workspace's where it has none, Keep write's gone", async () => {
  const { getDb, schema } = await import("@/db");
  const { isInstalled, rewriteRetiredPlugins, RETIRED_PLUGINS_ONCE } = await import("@/plugins/state");
  const { onceDone } = await import("@/lib/once-done");
  const at = new Date().toISOString();
  getDb().delete(schema.plugins).run();
  for (const [id, installed] of [["kanban", false], ["notes", true], ["keep-write", true]] as const) getDb().insert(schema.plugins).values({ id, installed, changedAt: at }).run();
  assert.equal(await onceDone(RETIRED_PLUGINS_ONCE, rewriteRetiredPlugins), 3);
  const rows = getDb().select().from(schema.plugins).all();
  assert.deepEqual(rows.map((r) => [r.id, r.installed]), [["workspace", false]], "the first one's choice (Kanban off)");
  assert.equal(isInstalled("workspace"), false);
  assert.equal(await onceDone(RETIRED_PLUGINS_ONCE, rewriteRetiredPlugins), undefined, "once");
  getDb().insert(schema.plugins).values({ id: "kanban", installed: true, changedAt: at }).run();
  assert.equal(rewriteRetiredPlugins(), 1);
  assert.deepEqual(getDb().select().from(schema.plugins).all().map((r) => [r.id, r.installed]), [["workspace", false]], "the Workspace's own choice stays");
});

test("with the Workspace off, own boards are not in the briefing", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("keep", false);
  setInstalled("workspace", false);
  const { notesInLage } = await import("@/plugins/keep/lage");
  assert.equal(notesInLage(), false);
  setInstalled("workspace", true);
  assert.equal(notesInLage(), true);
});
