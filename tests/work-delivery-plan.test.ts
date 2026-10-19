import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/**
 * What a run's branch delivers is what it has beyond the default branch — not only what this run committed: a run that went on from
 * an earlier run's branch (another round, an answered question) has no commits of its own, but the branch carries the earlier ones.
 */
test("deliveryPlan: commits beyond the default branch count, also when the run itself made none", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-"));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "T");
  fs.writeFileSync(path.join(dir, "a.txt"), "a");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "base");
  // main as the remote's default branch.
  git(dir, "update-ref", "refs/remotes/origin/main", "HEAD");
  git(dir, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  git(dir, "checkout", "-q", "-b", "feature/PROJ-1-x");
  fs.writeFileSync(path.join(dir, "b.txt"), "b");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "feat(PROJ-1): b");
  const earlier = git(dir, "rev-parse", "HEAD");

  const { deliveryPlan } = await import("@/lib/work/runner");
  const run = (baseSha: string) => ({ id: 91, cwd: dir, branch: "feature/PROJ-1-x", baseSha, repo: dir, todoId: 0, ticket: "PROJ-1", entryLine: "B bauen", summary: "s" }) as never;
  // A run that began on the earlier run's last commit: nothing of its own — the branch still has to be delivered.
  const plan = await deliveryPlan(run(earlier));
  assert.ok(plan, "the branch is ahead of main");
  assert.match(plan.text, /feature\/PROJ-1-x/);
  // A branch with nothing beyond main: nothing to deliver.
  git(dir, "checkout", "-q", "main");
  git(dir, "checkout", "-q", "-b", "feature/PROJ-2-empty");
  const empty = await deliveryPlan({ ...(run(git(dir, "rev-parse", "HEAD")) as object), branch: "feature/PROJ-2-empty" } as never);
  assert.equal(empty, null);
});

test("deliveryPlan: pushed under the branch's own name when it follows the scheme (also renamed) — not made of the booking line", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-"));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "T");
  fs.writeFileSync(path.join(dir, "a.txt"), "a");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "base");
  git(dir, "update-ref", "refs/remotes/origin/main", "HEAD");
  git(dir, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  const base = git(dir, "rev-parse", "HEAD");
  git(dir, "checkout", "-q", "-b", "feature/PROJ-436-responsive-images-fuer");
  fs.writeFileSync(path.join(dir, "b.txt"), "b");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "feat(PROJ-436): svg");
  // The worker names the branch for what the change is.
  git(dir, "branch", "-m", "feature/PROJ-436-svg-ohne-source-ausspielen");

  const { deliveryPlan } = await import("@/lib/work/runner");
  const run = { id: 91, cwd: dir, branch: "feature/PROJ-436-responsive-images-fuer", baseSha: base, repo: dir, todoId: 0, ticket: "PROJ-436", entryLine: "SVG-Umsetzung nachgeprüft, Ergebnis eingetragen", summary: "s" } as never;
  const plan = await deliveryPlan(run);
  assert.ok(plan);
  assert.equal(plan.local, "feature/PROJ-436-svg-ohne-source-ausspielen", "the branch as it is now");
  assert.equal(plan.branch, "feature/PROJ-436-svg-ohne-source-ausspielen", "pushed under that name");
  assert.doesNotMatch(JSON.stringify(plan.ops), /nachgeprueft|ergebnis/i, "nothing made of the booking line");
});

test("deliveryPlan: a branch that is on the remote already needs only the merge request", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-"));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "T");
  fs.writeFileSync(path.join(dir, "a.txt"), "a");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "base");
  git(dir, "update-ref", "refs/remotes/origin/main", "HEAD");
  git(dir, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  const base = git(dir, "rev-parse", "HEAD");
  git(dir, "checkout", "-q", "-b", "feature/PROJ-7-pushed");
  fs.writeFileSync(path.join(dir, "b.txt"), "b");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "feat(PROJ-7): b");
  const { saveRepo } = await import("@/lib/repos");
  saveRepo({ name: "plan", path: dir, gitlabProject: "grp/proj", boards: [], tickets: [], instructions: "", delivery: "mr" } as never);
  const { deliveryPlan } = await import("@/lib/work/runner");
  const run = { id: 5, cwd: dir, branch: "feature/PROJ-7-pushed", baseSha: base, repo: dir, todoId: 0, ticket: "PROJ-7", entryLine: "B", summary: "s" } as never;
  const before = await deliveryPlan(run);
  assert.deepEqual(before!.ops.map((o) => o.type), ["git-push", "gitlab-open-mr"], "not pushed yet: both");
  // Pushed: the remote-tracking branch is at the commit.
  git(dir, "update-ref", "refs/remotes/origin/feature/PROJ-7-pushed", "HEAD");
  const after = await deliveryPlan(run);
  assert.deepEqual(after!.ops.map((o) => o.type), ["gitlab-open-mr"], "on the remote already: the merge request only");
  assert.match(after!.text, /merge request/i);
});
