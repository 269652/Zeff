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

test("a worker's branch is shown as context even before GitLab has synced it — from its run and its follow-ups; the real sync takes over", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { execFileSync } = await import("node:child_process");
  const { getDb, schema } = await import("@/db");
  const { saveRepo } = await import("@/lib/repos");
  const { createRun } = await import("@/lib/work/store");
  const { addFollowUp, getTodo } = await import("@/lib/boards/store");
  const { linkBranchContext } = await import("@/lib/work/branch-context");
  const { saveGitlabItems } = await import("@/lib/gitlab/store");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-repo-"));
  execFileSync("git", ["init", "-q", dir]);
  execFileSync("git", ["-C", dir, "remote", "add", "origin", "https://git.example.com/grp/proj.git"]);
  saveRepo({ name: "proj", path: dir, gitlabProject: "grp/proj", boards: [], tickets: ["WF-4"], instructions: "", delivery: "mr" });
  const parent = await mk("WF-4", "Implement the setting");
  createRun({ ticket: "WF-4", todoId: parent.id, mode: "code", provider: "agent", model: "Claude Code", permissionMode: null, repo: dir, prompt: "x", branch: "feature/WF-4-setting" });
  // The worker's internal worktree branch isn't a branch to show.
  createRun({ ticket: "WF-4", todoId: parent.id, mode: "code", provider: "claude", model: "sonnet", permissionMode: null, repo: dir, prompt: "x", branch: "zeff/w9-internal" });
  const child = addFollowUp({ ticket: "WF-4", text: "Test and verify by hand", kind: "test", parentId: parent.id, workRunId: null, source: "test" });

  assert.equal(linkBranchContext([parent.id, child.id]), 2); // the parent's, and the follow-up of the parent's work
  const row = getDb().select().from(schema.gitlabItems).all().find((i) => i.key === "branch:grp/proj:feature/WF-4-setting");
  assert.ok(row, "a branch item is there");
  assert.equal(row.kind, "branch");
  assert.equal(row.url, "https://git.example.com/grp/proj/-/tree/feature/WF-4-setting");
  assert.equal(row.state, "not pushed");
  assert.ok(!getDb().select().from(schema.gitlabItems).all().some((i) => /zeff\/w9/.test(i.key)));
  for (const id of [parent.id, child.id]) assert.ok(getTodo(id)!.refs.includes("gitlab:branch:grp/proj:feature/WF-4-setting"), `T-${id} has it`);

  // The sync that sees it on GitLab replaces it (same key).
  saveGitlabItems([{ key: "branch:grp/proj:feature/WF-4-setting", kind: "branch", project: "grp/proj", projectUrl: "https://git.example.com/grp/proj", ref: "feature/WF-4-setting", title: "feature/WF-4-setting", body: "", url: "https://git.example.com/grp/proj/-/tree/feature/WF-4-setting", branch: "feature/WF-4-setting", state: null } as never]);
  assert.equal(getDb().select().from(schema.gitlabItems).all().find((i) => i.key === "branch:grp/proj:feature/WF-4-setting")!.state, null);
  assert.equal(linkBranchContext([parent.id]), 0);
});
