import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * The command palette (Ctrl/⌘+K) does things in the Workspace too: a new page or database, a pipeline refreshed — found by
 * what you type ("refresh important", "neue seite"), next to the pages and rows it finds already.
 */
test("palette actions: new page, new database, refresh a pipeline — filtered like the pages", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("workspace", true);
  const w = await import("@/plugins/workspace/store");
  const m = await import("@/plugins/workspace/model");
  const { filterPalette } = await import("@/lib/palette");
  const { workspacePaletteItems } = await import("@/plugins/workspace/palette");
  const db = w.createPage({ kind: "database", title: "Wichtige Mails", schema: { titleName: "S", properties: [], views: [m.newView("Table")], pipeline: { steps: [{ id: "s", kind: "source", from: "todos" }] } } });
  w.createPage({ kind: "database", title: "Ohne Pipeline", schema: { titleName: "S", properties: [], views: [m.newView("Table")] } });
  const items = workspacePaletteItems();
  const ids = (q: string) => filterPalette(items, q).map((x) => x.id);
  assert.ok(ids("new page").includes("ws:new-page"));
  assert.ok(ids("neue seite").includes("ws:new-page"), "in German too");
  assert.ok(ids("new database").includes("ws:new-database"));
  assert.deepEqual(ids("refresh wichtige"), [`ws:refresh:${db}`], "a pipeline's refresh, by its name");
  assert.ok(!ids("refresh").some((x) => x.includes("Ohne")), "only databases with a pipeline");
  assert.equal(items.find((x) => x.id === `ws:refresh:${db}`)!.href, `zeff:refresh:${db}`);
  assert.equal(items.find((x) => x.id === "ws:new-page")!.group, "Actions");
});

/**
 * The commands palette (Ctrl/⌘+Shift+K) lists everything that can be run by hand in the Workspace: its routines (agents and
 * automations, also the ones switched off), each waiting job of a jobs database and "all open jobs" of it — besides the actions.
 */
test("commands: routines, waiting jobs and all open jobs of a jobs database", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("workspace", true);
  const w = await import("@/plugins/workspace/store");
  const { createRoutine } = await import("@/plugins/workspace/routines");
  const { createJobsDatabase, addJob } = await import("@/plugins/workspace/jobs");
  const { filterPalette } = await import("@/lib/palette");
  const { workspaceCommandItems } = await import("@/plugins/workspace/palette");
  const agent = w.createPage({ title: "Mail-Agent" });
  createRoutine(agent, "agent");
  const auto = w.createPage({ title: "Wochenputz" });
  createRoutine(auto, "automation");
  const jobs = createJobsDatabase(null, "Aufträge");
  const job = addJob(jobs, { title: "Logo tauschen", instruction: "x" });
  const items = workspaceCommandItems();
  const ids = (q: string) => filterPalette(items, q).map((x) => x.id);
  assert.deepEqual(ids("mail-agent"), [`ws:routine:${agent}`]);
  assert.equal(items.find((x) => x.id === `ws:routine:${agent}`)!.href, `zeff:routine:${agent}`);
  assert.equal(items.find((x) => x.id === `ws:routine:${agent}`)!.group, "Agents");
  assert.equal(items.find((x) => x.id === `ws:routine:${auto}`)!.group, "Automations");
  assert.deepEqual(ids("logo"), [`ws:job:${job}`]);
  assert.equal(items.find((x) => x.id === `ws:job:${job}`)!.href, `zeff:job:${job}`);
  assert.equal(items.find((x) => x.id === `ws:jobs:${jobs}`)!.href, `zeff:jobs:${jobs}`);
  assert.ok(items.some((x) => x.id === "ws:new-page"), "the actions too");
});
