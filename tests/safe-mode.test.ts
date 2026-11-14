import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();
const PLUGINS = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-safe-plugins-"));
process.env.ZEFF_PLUGINS_DIR = PLUGINS;
delete process.env.ZEFF_SAFE_MODE;

/**
 * Safe mode for everything stored (lib/kernel/safe-mode.ts, docs/zeff-kernel.md): one switch. Plugins read as off, and nothing starts
 * by itself. What you had on comes back when you leave. A broken part is repaired from its history while Zeff is in safe mode. And
 * the start guard (lib/kernel/boot-guard.ts) switches safe mode on after two starts in a row that didn't come up.
 */

async function world() {
  // (The registry first: loaded from plugins/state, db/accounts → i18n/plugin-strings → registry … comes back to db/accounts unfinished.)
  const reg = await import("@/lib/ext/registry");
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "todos"]) setInstalled(id, true);
  await import("@/plugins/contributions");
  return { sm: await import("@/lib/kernel/safe-mode"), reg };
}

test("one switch: on with why, off again; the Mods page's switch is the same one", async () => {
  const { sm } = await world();
  const mods = await import("@/lib/mods/store");
  assert.equal(sm.safeMode(), false);
  mods.setSafeMode(true);
  assert.equal(sm.safeMode(), true);
  assert.equal(sm.safeModeState().by, "you");
  sm.setSafeMode(false);
  assert.equal(mods.safeMode(), false);
  sm.setSafeMode(true, { by: "auto", reason: "testing" });
  assert.deepEqual({ ...sm.safeModeState(), since: undefined }, { on: true, since: undefined, by: "auto", reason: "testing" });
  sm.setSafeMode(false);
});

test("an external plugin you turned on reads as off in safe mode, and is on again after", async () => {
  const { sm, reg } = await world();
  fs.mkdirSync(path.join(PLUGINS, "safe-probe"), { recursive: true });
  fs.writeFileSync(path.join(PLUGINS, "safe-probe", "zeff-plugin.json"), JSON.stringify({ id: "safe-probe", name: "Safe probe", apiVersion: 1 }));
  reg.scanPlugins(true);
  reg.setEnabled("safe-probe", true);
  assert.equal(reg.isEnabled("safe-probe"), true);
  sm.setSafeMode(true);
  assert.equal(reg.isEnabled("safe-probe"), false);
  assert.equal(reg.enabledPlugins().length, 0);
  sm.setSafeMode(false);
  assert.equal(reg.isEnabled("safe-probe"), true, "what you had on is kept");
});

test("flows: by clock or event they wait in safe mode; started by you they run", async () => {
  const { sm } = await world();
  const flows = await import("@/plugins/workspace/flows/store");
  const { runFlow } = await import("@/plugins/workspace/flows/engine");
  const f = flows.createFlow({ name: "safe.hello", title: "Hello", nodes: [{ id: "a", kind: "return", value: "hi" }], permissions: {} });
  sm.setSafeMode(true);
  try {
    await assert.rejects(runFlow(f.name, {}, { trigger: { kind: "schedule" } }), /Safe mode/);
    await assert.rejects(runFlow(f.name, {}, { trigger: { kind: "event", event: "row.added" } }), /Safe mode/);
    const r = await runFlow(f.name, {});
    assert.equal(r.status, "done");
    const { fireRoutineEvent } = await import("@/plugins/workspace/routine-triggers");
    assert.equal(await fireRoutineEvent("row.added", {}), 0);
  } finally {
    sm.setSafeMode(false);
  }
});

test("repair in safe mode: a broken flow brought back from its history, then it runs again", async () => {
  const { sm } = await world();
  const flows = await import("@/plugins/workspace/flows/store");
  const pv = await import("@/plugins/workspace/part-versions");
  const { restorePart } = await import("@/plugins/workspace/part-restore");
  const { runFlow } = await import("@/plugins/workspace/flows/engine");
  const f = flows.createFlow({ name: "safe.repair", title: "Repair", nodes: [{ id: "a", kind: "return", value: "fine" }], permissions: {} });
  // An update (or a change by the AI) breaks it.
  flows.saveFlow(f.pageId, { ...flows.getFlow(f.pageId)!, nodes: [{ id: "a", kind: "fail", message: "broken by an update" }] });
  sm.setSafeMode(true, { by: "auto", reason: "Zeff didn't start" });
  try {
    assert.equal((await runFlow(f.name, {})).status, "failed");
    const before = pv.partVersions("flow", f.pageId);
    assert.ok(before.length >= 1, "the working version is in the history");
    await restorePart(before[0].id);
    assert.equal((await runFlow(f.name, {})).output, "fine", "repaired while in safe mode");
  } finally {
    sm.setSafeMode(false);
  }
});

test("repair in safe mode: an update that broke a whole app is taken back to the save point kept before it", async () => {
  const { sm } = await world();
  const w = await import("@/plugins/workspace/store");
  const life = await import("@/plugins/workspace/package-life");
  const schemaOf = (field: string) => ({ titleName: "Name", properties: [{ id: "f", name: field, type: "text" }], views: [{ id: "all", name: "All", type: "table", filter: { and: [] }, sorts: [], hidden: [] }] });
  const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
  const pkg = (version: string, intro: string, field: string) => ({ format: 1 as const, id: "safeapp", name: "Safe app", version, items: [{ id: "i1", kind: "page", title: "Safe app", content: doc(intro) }, { id: "i2", parent: "i1", kind: "database", title: "Items", schema: schemaOf(field) }] });
  await life.installTracked(pkg("1.0.0", "Works", "Colour") as never, null);
  const inst = life.getInstalled("safeapp")!;
  const row = w.addRow(inst.map.i2, { title: "Ball" });
  await life.updateTracked("safeapp", pkg("2.0.0", "Broken by 2.0.0", "Broken") as never);
  assert.match(JSON.stringify(w.getPage(inst.rootId)!.content), /Broken/);
  // Zeff came up in safe mode after the update; the app is taken back from there.
  sm.setSafeMode(true, { by: "auto", reason: "Zeff didn't start 2 times in a row" });
  try {
    const before = life.appHistory("safeapp").savePoints.find((p) => /Before the update to 2\.0\.0/.test(p.label));
    assert.ok(before, "an update keeps a save point first");
    await life.restoreSavePoint("safeapp", before.n);
    assert.match(JSON.stringify(w.getPage(inst.rootId)!.content), /Works/);
    assert.ok(w.getDatabase(inst.map.i2)!.schema.properties.some((p) => p.name === "Colour"));
    assert.ok(w.rawRows(inst.map.i2).some((r) => r.id === row), "your entries stay");
  } finally {
    sm.setSafeMode(false);
  }
});

test("the bar on every page: there only in safe mode, with why, and the way out", async () => {
  const { sm } = await world();
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { createElement } = await import("react");
  const { SafeModeBar } = await import("@/components/SafeModeBar");
  assert.equal(renderToStaticMarkup(createElement(SafeModeBar)), "");
  sm.setSafeMode(true, { by: "auto", reason: "Zeff didn't start 2 times in a row (it stopped while loading the mods)." });
  try {
    const html = renderToStaticMarkup(createElement(SafeModeBar));
    assert.match(html, /Safe mode/);
    assert.match(html, /loading the mods/);
    assert.match(html, /Leave safe mode/);
    assert.match(html, /href="\/mods"/);
  } finally {
    sm.setSafeMode(false);
  }
});

test("the start guard: two starts that never came up switch safe mode on, naming the step; one that came up resets", async () => {
  const { sm } = await world();
  const guard = await import("@/lib/kernel/boot-guard");
  const role = "test";
  assert.equal(guard.beginBoot({ role, manual: true }).failures, 0);
  guard.bootStep("loading the mods");
  // (the process dies here)
  assert.equal(guard.beginBoot({ role, manual: true }).failures, 1);
  assert.equal(sm.safeMode(), false, "one failed start is not enough");
  guard.bootStep("loading the mods");
  const third = guard.beginBoot({ role, manual: true });
  assert.equal(third.failures, 2);
  assert.equal(third.safeModeOn, true);
  assert.equal(third.stoppedIn, "loading the mods");
  const s = sm.safeModeState();
  assert.equal(s.by, "auto");
  assert.match(s.reason ?? "", /loading the mods/);
  sm.setSafeMode(false);
  guard.markHealthy();
  assert.equal(guard.beginBoot({ role, manual: true }).failures, 0, "a start that came up counts from zero again");
  // Got through its steps, then killed (a dev server restarted while it compiles): not a failed start, however often.
  for (let i = 0; i < 3; i++) {
    guard.bootReady();
    assert.equal(guard.beginBoot({ role, manual: true }).failures, 0);
  }
  assert.equal(sm.safeMode(), false);
  guard.markHealthy();
});
