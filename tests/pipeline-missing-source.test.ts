import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

test("pipeline: a plugin's source not there (not loaded yet, uninstalled) is an error — the rows stay, nothing is archived", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("workspace", true);
  const { createPage, addRow, rawRows } = await import("@/plugins/workspace/store");
  const { runPipeline } = await import("@/plugins/workspace/pipeline");
  const id = createPage({ kind: "database", title: "Cases", schema: { titleName: "Name", properties: [], views: [], pipeline: { steps: [{ id: "s1", kind: "source", from: "ext", ext: "no-such-source" }] } } as never });
  addRow(id, { title: "DR II 1121/26", cells: { srcref: "case:1" } });
  const r = await runPipeline(id, { ai: false });
  assert.equal(r.ok, false);
  assert.match(String(r.error), /no-such-source/);
  assert.equal(rawRows(id).length, 1, "the row is still there");
});
