import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

async function mk(ticket: string, text: string, planned?: unknown[]) {
  const { addFollowUp } = await import("@/lib/boards/store");
  return addFollowUp({ ticket, text, kind: "implement", parentId: null as unknown as number, workRunId: null, source: "test", planned: planned as never });
}

test("a worker only suggests its todo as done (grey tick) — ticking it off is yours", async () => {
  const { markWorkerDone, getTodo } = await import("@/lib/boards/store");
  const t = await mk("WF-1", "Implement it");
  markWorkerDone(t.id, "W-62 · Claude Code", "Die Migration legt keine Datenbank an");
  const v = getTodo(t.id)!;
  assert.equal(v.status, "open");
  assert.equal(v.workerDone?.suggested, true);
  assert.equal(v.workerDone?.by, "W-62 · Claude Code");
});

test("the delivery of a worker's branch is planned behind its todo: test by hand first, then the delivery — both appear only once the todo is ticked off", async () => {
  const { addTestedDelivery, getTodo, listTodos, setTodoStatus } = await import("@/lib/boards/store");
  const t = await mk("WF-2", "Migrationslogik umbauen", [{ path: null, steps: [{ text: "Deploy auf Test und prüfen", kind: "other", owner: "me", ops: [] }] }]);
  const ops = [{ type: "git-push", repo: "C:/r", branch: "zeff/w1", remote: "feature/WF-2-umbau", target: "main", title: "t", description: "d" }];
  const r = addTestedDelivery({ from: t, workRunId: null, source: "Follow-up from W-62", branch: "feature/WF-2-umbau", delivery: { text: "Deliver feature/WF-2-umbau: merge request into main", ops: ops as never } });
  // Nothing new in the list yet — it's on the todo's plan.
  assert.equal(r.id, t.id);
  assert.deepEqual(listTodos({ ticket: "WF-2", status: "open" }).map((x) => x.id), [t.id]);
  const plan = getTodo(t.id)!.planned;
  assert.equal(plan.length, 1);
  assert.deepEqual(plan[0].steps.map((s) => s.kind), ["test", "merge", "other"]);
  assert.match(plan[0].steps[0].text, /Test and verify by hand \(feature\/WF-2-umbau\): Migrationslogik umbauen/);
  assert.match(plan[0].steps[1].text, /Deliver feature\/WF-2-umbau/);
  // Ticked off: the test todo comes (the delivery behind it).
  setTodoStatus(t.id, "done");
  const open = listTodos({ ticket: "WF-2", status: "open" });
  assert.equal(open.length, 1);
  assert.match(open[0].text, /Test and verify by hand/);
  assert.equal(open[0].kind, "test");
  assert.deepEqual(open[0].planned[0].steps.map((s) => s.kind), ["merge", "other"]);
});

test("a worker's feature branch and its merge request join the todo's context, linked — once they're known to Zeff", async () => {
  const { getDb, schema } = await import("@/db");
  const { addTestedDelivery, getTodo } = await import("@/lib/boards/store");
  const { linkBranchContext } = await import("@/lib/work/branch-context");
  const t = await mk("WF-3", "Source-DB-Name konfigurierbar");
  const ops = [
    { type: "git-push", repo: "C:/r", branch: "zeff/w2", remote: "feature/WF-3-source-db", target: "main", title: "t", description: "d" },
    { type: "gitlab-open-mr", repo: "C:/r", project: "grp/proj", source: "feature/WF-3-source-db", target: "main", title: "t", description: "d" },
  ];
  addTestedDelivery({ from: t, workRunId: null, source: "Follow-up from W-63", branch: "feature/WF-3-source-db", delivery: { text: "Deliver", ops: ops as never } });
  assert.equal(linkBranchContext([t.id]), 0); // not pushed yet: nothing to link
  const at = new Date().toISOString();
  const db = getDb();
  db.insert(schema.gitlabItems).values({ key: "branch:grp/proj:feature/WF-3-source-db", kind: "branch", project: "grp/proj", projectUrl: "u", ref: "feature/WF-3-source-db", title: "feature/WF-3-source-db", body: "", url: "https://git/b", syncedAt: at, branch: "feature/WF-3-source-db" } as never).run();
  db.insert(schema.gitlabItems).values({ key: "mr:grp/proj!7", kind: "mr", project: "grp/proj", projectUrl: "u", ref: "!7", title: "WF-3: Source-DB", body: "", url: "https://git/mr7", syncedAt: at, branch: "feature/WF-3-source-db" } as never).run();
  db.insert(schema.gitlabItems).values({ key: "mr:grp/proj!8", kind: "mr", project: "grp/proj", projectUrl: "u", ref: "!8", title: "other", body: "", url: "https://git/mr8", syncedAt: at, branch: "feature/other" } as never).run();
  assert.equal(linkBranchContext([t.id]), 2);
  const refs = getTodo(t.id)!.refs;
  assert.ok(refs.includes("gitlab:branch:grp/proj:feature/WF-3-source-db"));
  assert.ok(refs.includes("gitlab:mr:grp/proj!7"));
  assert.ok(!refs.includes("gitlab:mr:grp/proj!8"));
  assert.equal(linkBranchContext([t.id]), 0); // once
});
