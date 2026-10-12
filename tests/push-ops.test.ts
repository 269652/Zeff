import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

/** A repo with an origin (bare), main pushed, and a work branch with a commit. */
function repoWithBranch(name: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-push-"));
  const origin = path.join(root, "origin.git");
  const repo = path.join(root, "repo");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  execFileSync("git", ["clone", "-q", origin, repo]);
  git(repo, "config", "user.email", "t@t");
  git(repo, "config", "user.name", "t");
  fs.writeFileSync(path.join(repo, "a.txt"), "a");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "init");
  git(repo, "push", "-q", "origin", "HEAD:main");
  git(repo, "remote", "set-head", "origin", "main");
  git(repo, "switch", "-qc", name);
  fs.writeFileSync(path.join(repo, "b.txt"), "b");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "work");
  return repo;
}

async function setup(ticket: string, repo: string, branch: string, provider = "agent", gitlabProject: string | null = null) {
  const { saveRepo } = await import("@/lib/repos");
  const { createRun } = await import("@/lib/work/store");
  const { addFollowUp } = await import("@/lib/boards/store");
  saveRepo({ name: `r-${ticket}`, path: repo, gitlabProject, boards: [], tickets: [ticket], instructions: "", delivery: "mr" });
  const todo = addFollowUp({ ticket, text: "Implement the setting", kind: "implement", parentId: null as unknown as number, workRunId: null, source: "test", ops: [{ type: "jira-transition", ticket, to: "In Progress" }] });
  createRun({ ticket, todoId: todo.id, mode: "code", provider, model: "Claude Code", permissionMode: null, repo, prompt: "x", branch });
  return todo;
}

test("a work branch that exists but isn't pushed gets a push action — no AI, added to the todo's other actions, once", async () => {
  const repo = repoWithBranch("feature/PU-1-setting");
  const todo = await setup("PU-1", repo, "feature/PU-1-setting");
  const { attachOpenMrOps } = await import("@/lib/boards/delivery-ops");
  const { getTodo } = await import("@/lib/boards/store");
  assert.ok((await attachOpenMrOps()) >= 1);
  const ops = getTodo(todo.id)!.ops;
  assert.deepEqual(ops.map((o) => o.type), ["jira-transition", "git-push"]);
  const push = ops[1] as { branch: string; remote: string; repo: string; target: string };
  assert.equal(push.branch, "feature/PU-1-setting");
  assert.equal(push.remote, "feature/PU-1-setting");
  assert.equal(push.target, "main");
  assert.equal(path.resolve(push.repo), path.resolve(repo));
  await attachOpenMrOps();
  assert.equal(getTodo(todo.id)!.ops.length, 2, "not twice");
});

test("nothing to push: already on origin, no commits of its own, or a worker's own worktree branch", async () => {
  const { attachOpenMrOps } = await import("@/lib/boards/delivery-ops");
  const { getTodo } = await import("@/lib/boards/store");
  const pushed = repoWithBranch("feature/PU-2-done");
  git(pushed, "push", "-q", "origin", "feature/PU-2-done");
  const a = await setup("PU-2", pushed, "feature/PU-2-done");
  const empty = repoWithBranch("feature/PU-3-empty");
  git(empty, "reset", "-q", "--hard", "main"); // no commits of its own
  const b = await setup("PU-3", empty, "feature/PU-3-empty");
  const internal = repoWithBranch("zeff/w5-internal");
  const c = await setup("PU-4", internal, "zeff/w5-internal", "claude");
  await attachOpenMrOps();
  for (const t of [a, b, c]) assert.deepEqual(getTodo(t.id)!.ops.map((o) => o.type), ["jira-transition"], `T-${t.id}`);
});

test("once the branch is on the remote the push action goes and \"Open MR\" comes — unless a merge request exists; and not without a GitLab project", async () => {
  const { attachOpenMrOps } = await import("@/lib/boards/delivery-ops");
  const { getTodo } = await import("@/lib/boards/store");
  const { getDb, schema } = await import("@/db");
  const repo = repoWithBranch("feature/PU-5-mr");
  const todo = await setup("PU-5", repo, "feature/PU-5-mr", "agent", "grp/proj");
  await attachOpenMrOps();
  assert.deepEqual(getTodo(todo.id)!.ops.map((o) => o.type), ["jira-transition", "git-push"]); // not pushed: only the push (the MR needs the branch there)
  git(repo, "push", "-q", "origin", "feature/PU-5-mr");
  await attachOpenMrOps();
  const ops = getTodo(todo.id)!.ops;
  assert.deepEqual(ops.map((o) => o.type), ["jira-transition", "gitlab-open-mr"]);
  const mr = ops[1] as { project: string; source: string; target: string };
  assert.deepEqual([mr.project, mr.source, mr.target], ["grp/proj", "feature/PU-5-mr", "main"]);
  await attachOpenMrOps();
  assert.equal(getTodo(todo.id)!.ops.length, 2, "not twice");

  // A merge request for the branch exists (as synced): no action to open one.
  const repo2 = repoWithBranch("feature/PU-6-has-mr");
  git(repo2, "push", "-q", "origin", "feature/PU-6-has-mr");
  const t2 = await setup("PU-6", repo2, "feature/PU-6-has-mr", "agent", "grp/proj");
  getDb().insert(schema.gitlabItems).values({ key: "mr:grp/proj!61", kind: "mr", project: "grp/proj", projectUrl: "u", ref: "!61", title: "PU-6", body: "", url: "https://git/61", syncedAt: new Date().toISOString(), branch: "feature/PU-6-has-mr", state: "opened" } as never).run();
  // No GitLab project: nothing to open a merge request in.
  const repo3 = repoWithBranch("feature/PU-7-no-gitlab");
  git(repo3, "push", "-q", "origin", "feature/PU-7-no-gitlab");
  const t3 = await setup("PU-7", repo3, "feature/PU-7-no-gitlab");
  await attachOpenMrOps();
  assert.deepEqual(getTodo(t2.id)!.ops.map((o) => o.type), ["jira-transition"]);
  assert.deepEqual(getTodo(t3.id)!.ops.map((o) => o.type), ["jira-transition"]);
});

test("pushing a work branch is its own action: it runs alone (the other actions stay) and doesn't close the implement todo", async () => {
  const { attachOpenMrOps } = await import("@/lib/boards/delivery-ops");
  const { getTodo } = await import("@/lib/boards/store");
  const { runTodoOpsNow } = await import("@/lib/ops");
  const { opsSettle } = await import("@/lib/boards/shared");
  const repo = repoWithBranch("feature/PU-8-own-action");
  const todo = await setup("PU-8", repo, "feature/PU-8-own-action");
  await attachOpenMrOps();
  const ops = getTodo(todo.id)!.ops;
  assert.deepEqual(ops.map((o) => o.type), ["jira-transition", "git-push"]);
  // Only the push (index 1): it goes to the remote, the Jira transition stays on the todo.
  const r = await runTodoOpsNow(todo.id, { only: [1] });
  assert.equal(r.settled, false);
  assert.equal(git(repo, "rev-parse", "--verify", "--quiet", "refs/remotes/origin/feature/PU-8-own-action").length > 0, true);
  const after = getTodo(todo.id)!;
  assert.equal(after.status, "open");
  assert.deepEqual(after.ops.map((o) => o.type), ["jira-transition"]);
  // A push on its own doesn't make an implement todo done — a delivery todo it does.
  assert.equal(opsSettle({ kind: "implement", owner: "me", text: "x", ops: [ops[1]] }), false);
  assert.equal(opsSettle({ kind: "merge", owner: "me", text: "x", ops: [ops[1]] }), true);
});

test("a delivery todo that names the branch carries the push and the merge request — the implement todo before it doesn't take the push — and its context shows the branch", async () => {
  const { attachOpenMrOps } = await import("@/lib/boards/delivery-ops");
  const { getTodo, addFollowUp } = await import("@/lib/boards/store");
  const { getDb, schema } = await import("@/db");
  const repo = repoWithBranch("feature/PU-9-delivery");
  const work = await setup("PU-9", repo, "feature/PU-9-delivery", "agent", "grp/proj");
  // (An earlier pass had given the implement todo its own push.)
  const { setTodoOps } = await import("@/lib/boards/store");
  setTodoOps(work.id, [...getTodo(work.id)!.ops, { type: "git-push", repo, branch: "feature/PU-9-delivery", remote: "feature/PU-9-delivery", target: "main", title: "t", description: "d" }]);
  const test = addFollowUp({ ticket: "PU-9", text: "Manuell testen", kind: "test", parentId: work.id, workRunId: null, source: "test" });
  const deliver = addFollowUp({ ticket: "PU-9", text: "Merge Request für feature/PU-9-delivery öffnen.", kind: "merge", parentId: test.id, workRunId: null, source: "Planned after test" });
  getDb().insert(schema.gitlabItems).values({ key: "branch:grp/proj:feature/PU-9-delivery", kind: "branch", project: "grp/proj", projectUrl: "u", ref: "feature/PU-9-delivery", title: "feature/PU-9-delivery", body: "", url: "https://git/b", syncedAt: new Date().toISOString(), branch: "feature/PU-9-delivery" } as never).run();

  await attachOpenMrOps();
  assert.deepEqual(getTodo(deliver.id)!.ops.map((o) => o.type), ["git-push", "gitlab-open-mr"], "the delivery todo carries it");
  assert.deepEqual(getTodo(work.id)!.ops.map((o) => o.type), ["jira-transition"], "the implement todo's own push goes — the delivery covers it");
  // The branch is context of the delivery todo, though its text is all that names it.
  assert.ok(getTodo(deliver.id)!.refs.includes("gitlab:branch:grp/proj:feature/PU-9-delivery"));
  assert.ok(getTodo(work.id)!.refs.includes("gitlab:branch:grp/proj:feature/PU-9-delivery"));
});
