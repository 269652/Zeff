import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * Google Calendar's port (zeff-plugins/plugins/google-calendar-ext) and what it needed of the kernel: a flow marked as a sync is a step
 * of the Sync menu (its runs its history, its schedule its interval — also on the Sync settings page, in the built-in's place); a
 * connector's driver is reached through a flow action only with the flow's `sync` permission; a built-in whose port is on counts as
 * there for everything that asks, but its own sync step doesn't run.
 */

const PKG = path.resolve("../zeff-plugins/plugins/google-calendar-ext/google-calendar.package.json");
const have = fs.existsSync(PKG);

async function world() {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "calendar"]) setInstalled(id as never, true);
  await import("@/plugins/contributions");
  return { flows: await import("@/plugins/workspace/flows/store"), engine: await import("@/plugins/workspace/flows/engine"), types: await import("@/plugins/workspace/flows/types") };
}

test("a flow's sync marker and sync permission are kept; only known sources can be allowed", async () => {
  const { types } = await world();
  const f = types.normalizeFlow({ name: "x.sync", nodes: [], sync: { label: "X", what: "reads X", replaces: "gcalendar", chrome: true }, permissions: { sync: ["gcalendar", "nope"] } });
  assert.deepEqual(f.sync, { label: "X", what: "reads X", chrome: true, replaces: "gcalendar" });
  assert.deepEqual(f.permissions.sync, ["gcalendar"]);
  assert.equal(types.normalizeFlow({ name: "y", nodes: [], sync: { what: "no label" } }).sync, undefined);
});

test("gcal.sync needs the flow's sync permission; a dry run reads nothing", async () => {
  const { flows, engine } = await world();
  flows.createFlow({ name: "t.gcal.denied", nodes: [{ id: "r", kind: "action", action: "gcal.sync", input: {} }] });
  const denied = await engine.runFlow("t.gcal.denied");
  assert.equal(denied.status, "failed");
  assert.match(denied.error ?? "", /may not read Google Calendar/);
  flows.createFlow({ name: "t.gcal.dry", nodes: [{ id: "r", kind: "action", action: "gcal.sync", input: {} }], permissions: { sync: ["gcalendar"] } });
  const dry = await engine.runFlow("t.gcal.dry", {}, { dry: true });
  assert.equal(dry.status, "done");
});

test("a sync flow is a step of the Sync menu: run there, its last run shown, its schedule its interval", async () => {
  const { flows } = await world();
  flows.createFlow({ name: "t.menu.sync", nodes: [{ id: "s", kind: "set", vars: { message: "3 read" } }], output: { message: "3 read" }, sync: { label: "Test sync", what: "reads a test" }, triggers: [{ kind: "schedule", everyMinutes: 30 }] });
  const reg = await import("@/lib/sync/registry");
  const step = reg.syncOverview().steps.find((s) => s.key === "flow:t.menu.sync");
  assert.ok(step, "in the menu");
  assert.equal(step.label, "Test sync");
  assert.equal(step.everyMinutes, 30);
  const last = await reg.syncAndWaitHere("flow:t.menu.sync");
  assert.equal(last.lastOk, true);
  assert.equal(last.lastMessage, "3 read");
  flows.setSyncFlowMinutes("t.menu.sync", 0);
  assert.equal(reg.syncOverview().steps.find((s) => s.key === "flow:t.menu.sync")?.everyMinutes, 0, "by hand only");
  flows.setSyncFlowMinutes("t.menu.sync", 60);
  assert.equal(reg.syncOverview().steps.find((s) => s.key === "flow:t.menu.sync")?.everyMinutes, 60);
});

test("a built-in whose port is on is there through it — not its own sync step; its interval is the port's flow", { skip: !have && "zeff-plugins isn't beside Zeff" }, async () => {
  const { flows } = await world();
  const state = await import("@/plugins/state");
  const { getDb, schema } = await import("@/db");
  state.setInstalled("google-calendar", true);
  assert.equal(state.stepAvailable("gcalendar"), true);
  state.setInstalled("google-calendar", false);
  assert.equal(state.isInstalled("google-calendar"), false);
  // (the port on: its row as the registry keeps it)
  getDb().insert(schema.plugins).values({ id: "x:google-calendar-ext", installed: true, changedAt: new Date().toISOString() }).onConflictDoUpdate({ target: schema.plugins.id, set: { installed: true } }).run();
  state.setInstalled("todos", true); // (any change drops the memo)
  assert.equal(state.isInstalled("google-calendar"), true, "there through its port");
  assert.equal(state.onlyThroughPort("google-calendar"), true);
  assert.equal(state.stepAvailable("gcalendar"), false, "its own step doesn't run");
  // The port's package: the sync flow, allowed what it asks when installed with allow.
  const pkg = JSON.parse(fs.readFileSync(PKG, "utf8"));
  const life = await import("@/plugins/workspace/package-life");
  const r = await life.installTracked(pkg, null, { allow: true });
  assert.deepEqual(r.allowed, ["google-calendar.sync"]);
  const f = flows.flowByName("google-calendar.sync")!;
  assert.deepEqual(f.permissions.sync, ["gcalendar"]);
  assert.equal(f.sync?.replaces, "gcalendar");
  const { installedSyncSettings } = await import("@/plugins/sync-settings-modules");
  const gcal = installedSyncSettings().find((x) => x.plugin.id === "google-calendar");
  assert.deepEqual(gcal?.settings.intervals.map((i) => i.key), ["flow:google-calendar.sync"], "the built-in's interval is the flow's");
  gcal!.settings.intervals[0].set(30);
  assert.equal(gcal!.settings.intervals[0].get(), 30);
});

test("the kernel's action lists stand side by side: mail, connectors and the local AI's all there", async () => {
  await world();
  const { flowAction } = await import("@/plugins/workspace/flows/actions");
  for (const name of ["mail.thread", "row.op", "rows.set", "gcal.sync", "localai.save", "http.request"]) assert.ok(flowAction(name), name);
});
