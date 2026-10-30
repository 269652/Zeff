import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * Notes are the Workspace's now (the Notes plugin is retired, its id answers as the Workspace); Google Keep is a part of the
 * Workspace — only the sync with Google's notes, off until you install it.
 */
test("Keep is a part of the Workspace; the Workspace is on without Keep", async () => {
  const { pluginById } = await import("@/plugins/catalog");
  const { isInstalled, setInstalled } = await import("@/plugins/state");
  assert.equal(pluginById("notes").id, "workspace", "the retired id answers as the Workspace");
  assert.equal(pluginById("workspace").defaultInstalled, true);
  assert.deepEqual(pluginById("keep").dependsOn, ["workspace"]);
  assert.equal(pluginById("keep").extensions, undefined, "the note extensions are the Workspace's");
  assert.ok(pluginById("workspace").extensions!.some((e) => e.key === "note-review"));
  setInstalled("workspace", true);
  assert.equal(isInstalled("notes"), true);
  assert.equal(isInstalled("keep"), false, "Google Keep stays off until you install it");
});

test("switching a retired id changes nothing: the Workspace stays", async () => {
  const { isInstalled, setInstalled } = await import("@/plugins/state");
  setInstalled("workspace", true);
  assert.deepEqual(setInstalled("notes", false), []);
  assert.deepEqual(setInstalled("kanban", false), []);
  assert.equal(isInstalled("workspace"), true);
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
