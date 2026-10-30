import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * Notes and Keep are two plugins: Notes is the note boards in the Workspace (works alone, on by default), Google Keep only the sync
 * with Google's notes (needs Notes).
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

test("with Notes off, own boards are not in the briefing", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("keep", false);
  setInstalled("notes", false);
  const { notesInLage } = await import("@/plugins/keep/lage");
  assert.equal(notesInLage(), false);
  setInstalled("notes", true);
});
