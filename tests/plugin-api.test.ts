import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const external = (plugin: string, ...perms: string[]) => ({ plugin, source: "external" as const, permissions: new Set(perms), ungranted: [] as string[] });

/** A method is there while its plugin is installed, and not otherwise. */
test("the API follows the installed plugins", async () => {
  const { callApi, apiMethods, knownPermissions } = await import("@/lib/plugins/api");
  const { setInstalled } = await import("@/plugins/state");
  const caller = external("x", "work.read", "todos.read");
  setInstalled("todos", false);
  const off = await callApi(caller, "todos.list", {});
  assert.ok(!off.ok && off.error.code === "not_found");
  assert.ok(!("todos.read" in knownPermissions()), "its permissions go with it");
  setInstalled("todos", true);
  assert.ok((await callApi(caller, "todos.list", {})).ok);
  assert.ok("todos.read" in knownPermissions());
  assert.ok("hello" in apiMethods() && "storage.get" in apiMethods(), "Zeff's own are always there");
});

/** Every method says what it does and needs a permission someone brings; no two plugins bring the same name. */
test("every API method is described and its permission exists", async () => {
  const { apiPoint, apiMethods, knownPermissions } = await import("@/lib/plugins/api");
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "todos", "work"] as const) setInstalled(id, true);
  const names = apiPoint.list().flatMap((c) => Object.keys(c.impl.methods));
  assert.equal(new Set(names).size, names.length, "a method name is brought twice");
  const known = knownPermissions();
  for (const [name, m] of Object.entries(apiMethods())) {
    assert.ok(m.summary.length > 5, `${name}: no summary`);
    if (m.perm) assert.ok(m.perm in known, `${name} needs "${m.perm}", which no plugin brings`);
    if (m.plugin !== "core") assert.ok(name.startsWith(`${m.plugin}.`), `${name} isn't in ${m.plugin}'s area`);
  }
});

/** An external plugin's app is in the menu while the plugin is on, like a built-in app — and a panel it names must exist. */
test("external plugins bring apps to the menu", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-apps-"));
  process.env.ZEFF_PLUGINS_DIR = root;
  fs.mkdirSync(path.join(root, "team-board", "ui"), { recursive: true });
  fs.writeFileSync(path.join(root, "team-board", "ui", "board.html"), "<p>hi</p>");
  fs.writeFileSync(
    path.join(root, "team-board", "zeff-plugin.json"),
    JSON.stringify({ id: "team-board", name: "Team board", apiVersion: 1, contributes: { workPanels: [{ id: "board", title: "Team board", entry: "board.html" }], apps: [{ panel: "board", label: "Team board", short: "Team", hint: "Who works on what" }] } }),
  );
  const reg = await import("@/lib/ext/registry");
  const { allApps } = await import("@/plugins/tabs");
  reg.scanPlugins(true);
  assert.ok(!allApps().some((a) => a.href === "/ext/view/team-board/board"), "off: not in the menu");
  reg.setEnabled("team-board", true);
  const app = allApps().find((a) => a.href === "/ext/view/team-board/board");
  assert.ok(app, "on: in the menu");
  assert.deepEqual([app.label, app.short, app.place], ["Team board", "Team", "menu"]);
  reg.setEnabled("team-board", false);

  const { parseManifest } = await import("@/lib/ext/manifest");
  const bad = parseManifest(JSON.stringify({ id: "x-app", name: "X", apiVersion: 1, contributes: { apps: [{ panel: "nope", label: "N", short: "N" }] } }));
  assert.ok(!bad.ok && /no panel "nope"/.test(bad.error));
});
