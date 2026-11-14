import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * The connectors' ports (zeff-plugins: teams-ext, whatsapp-ext, signal-ext): each a package with a sync flow that calls the kernel's
 * connector.sync — only with the flow's `sync` permission for that source; while a port is on its built-in counts as there (its replies,
 * settings, pages), its own step doesn't run (the flow does, its interval on the Sync settings page), and the steps it shares with
 * others (todos found in messages, relations) still do.
 */

const PLUGINS = path.resolve("../zeff-plugins/plugins");
const have = ["teams", "whatsapp", "signal"].every((c) => fs.existsSync(path.join(PLUGINS, `${c}-ext`, `${c}.package.json`)));

async function world() {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "todos"]) setInstalled(id as never, true);
  await import("@/plugins/contributions");
  return { flows: await import("@/plugins/workspace/flows/store"), engine: await import("@/plugins/workspace/flows/engine") };
}

test("connector.sync: only a known source, only with the flow's sync permission for it; a dry run reads nothing", async () => {
  const { flows, engine } = await world();
  flows.createFlow({ name: "t.c.denied", nodes: [{ id: "r", kind: "action", action: "connector.sync", input: { source: "teams" } }], permissions: { sync: ["whatsapp"] } });
  const denied = await engine.runFlow("t.c.denied");
  assert.equal(denied.status, "failed");
  assert.match(denied.error ?? "", /may not read teams/);
  flows.createFlow({ name: "t.c.unknown", nodes: [{ id: "r", kind: "action", action: "connector.sync", input: { source: "fax" } }], permissions: { sync: ["teams"] } });
  assert.match((await engine.runFlow("t.c.unknown")).error ?? "", /reads teams, whatsapp, signal/);
  flows.createFlow({ name: "t.c.dry", nodes: [{ id: "r", kind: "action", action: "connector.sync", input: { source: "signal" } }], permissions: { sync: ["signal"] } });
  assert.equal((await engine.runFlow("t.c.dry", {}, { dry: true })).status, "done");
});

test("ports on: the built-ins there through them, their own steps not — shared steps still; each flow allowed its source", { skip: !have && "zeff-plugins isn't beside Zeff" }, async () => {
  const { flows } = await world();
  const state = await import("@/plugins/state");
  const { getDb, schema } = await import("@/db");
  const life = await import("@/plugins/workspace/package-life");
  for (const c of ["teams", "whatsapp", "signal"] as const) {
    state.setInstalled(c, false);
    getDb().insert(schema.plugins).values({ id: `x:${c}-ext`, installed: true, changedAt: new Date().toISOString() }).onConflictDoUpdate({ target: schema.plugins.id, set: { installed: true } }).run();
  }
  state.setInstalled("todos", true); // (drops the memo)
  for (const c of ["teams", "whatsapp", "signal"] as const) {
    assert.equal(state.isInstalled(c), true, `${c} there through its port`);
    assert.equal(state.stepAvailable(c), false, `${c}'s own step doesn't run`);
    const pkg = JSON.parse(fs.readFileSync(path.join(PLUGINS, `${c}-ext`, `${c}.package.json`), "utf8"));
    const r = await life.installTracked(pkg, null, { allow: true });
    assert.deepEqual(r.allowed, [`${c}.sync`]);
    const f = flows.flowByName(`${c}.sync`)!;
    assert.deepEqual(f.permissions.sync, [c]);
    assert.equal(f.sync?.replaces, c);
  }
  // Shared steps (todos found in messages) stay while a plugin brings them, even only through its port.
  state.setInstalled("llm", true);
  assert.ok((await import("@/plugins/catalog")).pluginsOfStep("mailtodos").some((p) => ["teams", "whatsapp", "signal"].includes(p)), "a step the connectors share");
  assert.equal(state.stepAvailable("mailtodos"), true, "still runs through the ports");
  const { installedSyncSettings } = await import("@/plugins/sync-settings-modules");
  const teams = installedSyncSettings().find((x) => x.plugin.id === "teams");
  assert.deepEqual(teams?.settings.intervals.map((i) => i.key), ["flow:teams.sync"]);
  const reg = await import("@/lib/sync/registry");
  const keys = reg.syncOverview().steps.map((s) => s.key);
  for (const c of ["teams", "whatsapp", "signal"]) {
    assert.ok(keys.includes(`flow:${c}.sync`), `${c}'s flow in the Sync menu`);
    assert.ok(!keys.includes(c), `${c}'s built-in step not`);
  }
});
