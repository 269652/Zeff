import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** A contribution is there only while its plugin is installed; a second one from the same plugin replaces the first. */
test("extension point: only installed plugins' contributions are listed", async () => {
  const { extensionPoint } = await import("@/lib/plugin-kit/extension-point");
  const { setInstalled } = await import("@/plugins/state");
  const point = extensionPoint<string>("test.things");
  assert.equal(extensionPoint<string>("test.things"), point, "same name, same point (a hot reload evaluates a module twice)");
  setInstalled("keep", true);
  setInstalled("gitlab", false);
  point.contribute("keep", "from keep");
  point.contribute("gitlab", "from gitlab");
  assert.deepEqual(point.list().map((c) => c.impl), ["from keep"]);
  assert.equal(point.all().length, 2);
  point.contribute("keep", "keep again");
  assert.deepEqual(point.list().map((c) => c.impl), ["keep again"], "replaced, not doubled");
  setInstalled("gitlab", true);
  assert.deepEqual(point.list().map((c) => c.plugin), ["keep", "gitlab"], "in registration order");
});

/** Kanban and Keep have no tabs of their own any more: the Workspace's tab is theirs (old links lead there). */
test("tabs: the Workspace has the tab, Kanban and Keep none", async () => {
  const { PLUGINS } = await import("@/plugins/catalog");
  const tabs = (id: string) => (PLUGINS.find((p) => p.id === id)?.tabs ?? []).map((t) => t.href);
  assert.deepEqual(tabs("workspace"), ["/workspace"]);
  assert.deepEqual(tabs("kanban"), []);
  assert.deepEqual(tabs("keep"), []);
});
