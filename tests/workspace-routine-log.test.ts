import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** The log tab of a routine shows every run: the newest first, older ones fetched page by page. */
test("runs: newest first, older ones after a given run, all of them reachable", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "work", "todos"]) setInstalled(id, true);
  const w = await import("@/plugins/workspace/store");
  const r = await import("@/plugins/workspace/routines");
  const id = w.createPage({ title: "Log" });
  r.createRoutine(id, "automation");
  const ids: number[] = [];
  for (let i = 0; i < 25; i++) {
    const run = r.startRun(id, { kind: "manual" });
    r.finishRun(run, { status: "done", log: [] });
    ids.push(run);
  }
  const first = r.routineRuns(id, 10);
  assert.deepEqual(first.map((x) => x.id), ids.slice(-10).reverse());
  const next = r.routineRuns(id, 10, first.at(-1)!.id);
  assert.deepEqual(next.map((x) => x.id), ids.slice(-20, -10).reverse());
  const rest = r.routineRuns(id, 10, next.at(-1)!.id);
  assert.equal(rest.length, 5, "the last page is what is left");
  assert.deepEqual(r.routineRuns(id, 10, rest.at(-1)!.id), [], "nothing older");
  const { routineRunsAction } = await import("@/plugins/workspace/actions");
  const a = await routineRunsAction(id, first.at(-1)!.id);
  assert.ok(a.ok && a.runs.length === 15 && a.more === false, "twenty a page; 15 are older than the first ten");
  for (let i = 0; i < 10; i++) r.finishRun(r.startRun(id, { kind: "manual" }), { status: "done", log: [] });
  const c = await routineRunsAction(id, r.routineRuns(id, 10).at(-1)!.id);
  assert.ok(c.ok && c.runs.length === 20 && c.more === true);
});
