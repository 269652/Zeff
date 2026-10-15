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

/** Kanban shows the boards its providers bring, and none of an uninstalled plugin's. */
test("kanban: board providers come through the extension point", async () => {
  const { providerBoards, providerBoard } = await import("@/plugins/kanban/providers");
  const { boardProviders } = await import("@/plugins/kanban/board-providers");
  const { setInstalled } = await import("@/plugins/state");
  assert.ok(boardProviders.all().some((c) => c.plugin === "jira-lage"), "Jira Lage contributes itself");

  setInstalled("signal", true);
  boardProviders.contribute("signal", {
    idPrefix: "sig-",
    list: () => [{ id: "sig-1", name: "Signal board", description: "", color: "zinc", source: "Signal", cards: 2, open: 1, href: "/kanban/sig-1", updatedAt: null }],
    get: async (id) => ({ id, name: "Signal board", description: "", source: "Signal", url: null, columns: [] }),
  });
  assert.ok((await providerBoards()).some((b) => b.id === "sig-1"));
  assert.equal((await providerBoard("sig-1"))?.name, "Signal board");
  assert.equal(await providerBoard("nothing-1"), null);

  setInstalled("signal", false);
  assert.ok(!(await providerBoards()).some((b) => b.id === "sig-1"), "uninstalled: not listed");
  assert.equal(await providerBoard("sig-1"), null, "and not served");
});

/** The header tabs' dropdowns come from the plugins that have them, while installed. */
test("tab menus: Kanban's and Keep's dropdowns follow their plugins", async () => {
  const { tabsWithMenu } = await import("@/plugins/tab-menus");
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("kanban", true);
  setInstalled("keep", false);
  assert.ok(tabsWithMenu().has("/kanban") && !tabsWithMenu().has("/keep"));
  setInstalled("keep", true);
  assert.ok(tabsWithMenu().has("/keep"));
  setInstalled("kanban", false);
  assert.ok(!tabsWithMenu().has("/kanban"));
});
