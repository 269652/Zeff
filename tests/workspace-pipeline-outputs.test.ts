import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * A pipeline's outputs and triggers: a "write" step puts the rows that come out into another database (title, the fields
 * of the same name, the text once) — made once each, changed when they change, never deleted, never made again when you
 * removed one; the pipeline runs by itself: its AI after every sync of its sources, or every N minutes.
 */
test("write step: the pipeline's rows into another database — once each, changes follow, deleted ones stay deleted", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("workspace", true);
  const w = await import("@/plugins/workspace/store");
  const m = await import("@/plugins/workspace/model");
  const { runPipeline } = await import("@/plugins/workspace/pipeline");
  const status: import("@/plugins/workspace/model").Property = { id: "st", name: "Status", type: "status", options: [{ id: "o1", name: "Offen", color: "gray", group: "todo" }, { id: "o2", name: "Fertig", color: "green", group: "done" }] };
  const prio: import("@/plugins/workspace/model").Property = { id: "pr", name: "Priority", type: "select", options: [{ id: "p1", name: "Hoch", color: "red" }] };
  const src = w.createPage({ kind: "database", title: "Quelle", schema: { titleName: "Name", properties: [status, prio], views: [m.newView("Table")] } });
  const a = w.addRow(src, { title: "Steuer", cells: { st: "o1", pr: "p1" } });
  w.addRow(src, { title: "Urlaub", cells: { st: "o2" } });
  const target = w.createPage({ kind: "database", title: "Ziel", schema: { titleName: "Titel", properties: [{ id: "tst", name: "Status", type: "text" }], views: [m.newView("Table")] } });
  const mid = w.createPage({ kind: "database", title: "Mitte", schema: { titleName: "Name", properties: [], views: [m.newView("Table")], pipeline: { steps: [
    { id: "s", kind: "source", from: "database", dbId: src },
    { id: "f", kind: "filter", openOnly: true },
    { id: "w", kind: "write", to: target },
  ] } } });

  assert.deepEqual(m.normalizePipeline({ autoAi: true, everyMinutes: "30", steps: [{ id: "w", kind: "write", to: "7" }, { id: "x", kind: "write" }] }), { steps: [{ id: "w", kind: "write", to: 7 }], autoAi: true, everyMinutes: 30 });

  await runPipeline(mid, { ai: false });
  assert.deepEqual(w.rawRows(target).map((r) => r.title), ["Steuer"], "only what came out (open)");
  const row = w.rawRows(target)[0];
  assert.equal(row.cells.tst, "Offen", "a field of the same name (a status as its name into a text)");

  w.setCell(a, "st", "o1");
  w.updatePage(a, { title: "Steuer 2025" });
  await runPipeline(mid, { ai: false });
  assert.deepEqual(w.rawRows(target).map((r) => r.title), ["Steuer 2025"], "a change follows");
  assert.equal(w.rawRows(target).length, 1, "not made again");

  w.archivePage(w.rawRows(target)[0].id);
  await runPipeline(mid, { ai: false });
  assert.equal(w.rawRows(target).length, 0, "removed by you: not made again");
});

test("triggers: AI after each sync for the pipelines that want it; due ones by the clock", async () => {
  const w = await import("@/plugins/workspace/store");
  const m = await import("@/plugins/workspace/model");
  const { afterSyncPlan, duePipelines } = await import("@/plugins/workspace/pipeline");
  const mk = (title: string, pipeline: Record<string, unknown>) => w.createPage({ kind: "database", title, schema: { titleName: "N", properties: [], views: [m.newView("Table")], pipeline: { steps: [{ id: "s", kind: "source", from: "todos" }], ...pipeline } as never } });
  const plain = mk("Plain", {});
  const auto = mk("Auto", { autoAi: true });
  const plan = afterSyncPlan();
  assert.deepEqual(plan.find((x) => x.id === plain), { id: plain, ai: false });
  assert.deepEqual(plan.find((x) => x.id === auto), { id: auto, ai: true });

  const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();
  const timed = mk("Timed", { everyMinutes: 30, ranAt: ago(31) });
  const fresh = mk("Fresh", { everyMinutes: 30, ranAt: ago(5) });
  const never = mk("Never", { everyMinutes: 30 });
  const ids = duePipelines().map((x) => x.id);
  assert.ok(ids.includes(timed) && ids.includes(never), "due, and never run");
  assert.ok(!ids.includes(fresh) && !ids.includes(plain), "not due; without a clock");
});
