import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const external = (plugin: string, ...perms: string[]) => ({ plugin, source: "external" as const, permissions: new Set(perms), ungranted: [] as string[] });

/** One registry for built-in and external callers: the same Kanban methods, an external plugin only with the permissions it was granted. */
test("kanban over the plugin API: permissions decide, built-in code needs none", async () => {
  const { callApi, callBuiltin } = await import("@/lib/plugins/api");
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("kanban", true);

  const created = await callBuiltin<number>("test", "kanban.boards.list"); // empty to begin with
  assert.deepEqual(created, []);
  const store = await import("@/plugins/kanban/store");
  const board = store.createBoard({ name: "Via API" });
  const [open, , done] = store.getBoard(board).columns;

  const reader = external("reader", "kanban.read");
  const writer = external("writer", "kanban.read", "kanban.write");
  const denied = await callApi(reader, "kanban.cards.add", { columnId: open.id, title: "No" });
  assert.ok(!denied.ok && denied.error.code === "permission" && /kanban\.write/.test(denied.error.message));

  const added = await callApi(writer, "kanban.cards.add", { columnId: open.id, title: "Ship it", labels: ["a", "b"], priority: "high", due: "2026-11-01" });
  assert.ok(added.ok);
  const card = added.ok ? (added.result as { id: number; ref: string; priority: string; labels: string[] }) : null!;
  assert.equal(card.priority, "high");
  assert.deepEqual(card.labels, ["a", "b"]);

  assert.ok((await callApi(writer, "kanban.cards.move", { id: card.id, columnId: done.id })).ok);
  const got = await callApi(reader, "kanban.boards.get", { id: board });
  assert.ok(got.ok);
  const cols = (got.ok ? got.result : null) as { columns: { done: boolean; cards: { title: string; doneAt: string | null }[] }[] };
  assert.equal(cols.columns[2].cards[0].title, "Ship it");
  assert.ok(cols.columns[2].cards[0].doneAt, "a card in the done column is done");

  // Bad input and store errors come back as errors, not crashes.
  for (const [method, params] of [
    ["kanban.cards.add", { columnId: open.id }], // no title
    ["kanban.cards.update", { id: card.id, priority: "someday" }],
    ["kanban.cards.update", { id: card.id, due: "tomorrow" }],
    ["kanban.cards.move", { id: 999999, columnId: open.id }],
  ] as const) assert.ok(!(await callApi(writer, method, params)).ok, `${method} ${JSON.stringify(params)}`);

  // Archive and restore, as the Archive page does.
  assert.ok((await callApi(writer, "kanban.cards.archive", { id: card.id })).ok);
  assert.equal(store.listArchivedCards(board).length, 1);
  assert.ok((await callApi(writer, "kanban.cards.restore", { id: card.id })).ok);
  assert.equal(store.listArchivedCards(board).length, 0);
});

/** A method is there while its plugin is installed, and not otherwise. */
test("the API follows the installed plugins", async () => {
  const { callApi, apiMethods, knownPermissions } = await import("@/lib/plugins/api");
  const { setInstalled } = await import("@/plugins/state");
  const caller = external("x", "kanban.read", "todos.read");
  setInstalled("kanban", false);
  const off = await callApi(caller, "kanban.boards.list", {});
  assert.ok(!off.ok && off.error.code === "not_found");
  assert.ok(!("kanban.read" in knownPermissions()), "its permissions go with it");
  setInstalled("kanban", true);
  assert.ok((await callApi(caller, "kanban.boards.list", {})).ok);
  assert.ok("kanban.read" in knownPermissions());
  assert.ok("hello" in apiMethods() && "storage.get" in apiMethods(), "Zeff's own are always there");
});

/** Every method says what it does and needs a permission someone brings; no two plugins bring the same name. */
test("every API method is described and its permission exists", async () => {
  const { apiPoint, apiMethods, knownPermissions } = await import("@/lib/plugins/api");
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["kanban", "todos", "work"] as const) setInstalled(id, true);
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
