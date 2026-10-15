import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { addBranchWorktree, addWorktree, listBranches, repoRoot, switchBranch } from "@/lib/work/git";
import { listFolder } from "@/lib/work/folders";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();

function makeRepo() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-branches-"));
  const repo = path.join(base, "app");
  fs.mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "t@example.com");
  git(repo, "config", "user.name", "T");
  fs.writeFileSync(path.join(repo, "a.txt"), "a");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "init");
  git(repo, "branch", "feature/x");
  git(repo, "branch", "other");
  return { base, repo };
}

test("branches are listed with where each is checked out; a folder finds its repo", () => {
  const { base, repo } = makeRepo();
  try {
    assert.equal(repoRoot(path.join(repo)), path.resolve(repo));
    fs.mkdirSync(path.join(repo, "sub"));
    assert.equal(repoRoot(path.join(repo, "sub")), path.resolve(repo));
    assert.equal(repoRoot(base), null);
    const l = listBranches(repo);
    assert.equal(l.current, "main");
    assert.deepEqual(l.branches.map((b) => b.name).sort(), ["feature/x", "main", "other"]);
    assert.equal(l.branches.find((b) => b.name === "main")!.current, true);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("work on an existing branch gets a worktree of its own; a branch checked out elsewhere is refused", () => {
  const { base, repo } = makeRepo();
  try {
    const w = addBranchWorktree(repo, "feature/x", 7);
    assert.equal(git(w.cwd, "symbolic-ref", "--short", "HEAD"), "feature/x");
    assert.ok(w.cwd.includes(".zeff-worktrees"));
    // Now taken: from the repo's view it is in a worktree; the current branch too.
    assert.equal(listBranches(repo).branches.find((b) => b.name === "feature/x")!.worktree, path.resolve(w.cwd));
    assert.throws(() => addBranchWorktree(repo, "feature/x", 8), /checked out in .* already/);
    assert.throws(() => addBranchWorktree(repo, "main", 9), /checked out in .* already/);
    assert.throws(() => addBranchWorktree(repo, "nope", 9), /doesn't exist/);
    // A new branch from a base (the default way) still works beside it.
    const n = addWorktree(repo, "ABC-1", 10, "other");
    assert.match(n.branch, /^zeff\/ABC-1-w10/);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("switching a session's branch: not with uncommitted changes, not to a branch used elsewhere", () => {
  const { base, repo } = makeRepo();
  try {
    const w = addWorktree(repo, "ABC-2", 3, "main");
    // Clean: switches to another free branch.
    assert.equal(switchBranch(w.cwd, "other"), "other");
    assert.equal(git(w.cwd, "symbolic-ref", "--short", "HEAD"), "other");
    // The repo's own branch is taken.
    assert.throws(() => switchBranch(w.cwd, "main"), /checked out in/);
    // Uncommitted: refused, nothing lost.
    fs.writeFileSync(path.join(w.cwd, "a.txt"), "changed");
    assert.throws(() => switchBranch(w.cwd, "feature/x"), /uncommitted changes/);
    assert.equal(fs.readFileSync(path.join(w.cwd, "a.txt"), "utf8"), "changed");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("the folder picker lists sub-folders, repos first, hidden ones left out", () => {
  const { base, repo } = makeRepo();
  try {
    fs.mkdirSync(path.join(base, "aaa"));
    fs.mkdirSync(path.join(base, ".hidden"));
    const l = listFolder(base);
    assert.deepEqual(l.dirs.map((d) => [d.name, d.repo]), [["app", true], ["aaa", false]]);
    assert.equal(l.repo, false);
    assert.equal(listFolder(repo).repo, true);
    assert.equal(listFolder(repo).parent, path.resolve(base));
    assert.throws(() => listFolder(path.join(base, "missing")), /isn't a folder/);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("a worker's worktree gets the branch name asked for (the next free one when taken), else its own zeff/… name", () => {
  const { base, repo } = makeRepo();
  try {
    const a = addWorktree(repo, "ABC-7", 21, "main", "feature/ABC-7-footer-link");
    assert.equal(a.branch, "feature/ABC-7-footer-link");
    assert.equal(git(a.cwd, "symbolic-ref", "--short", "HEAD"), "feature/ABC-7-footer-link");
    // The same name asked for again: the next one is free.
    const b = addWorktree(repo, "ABC-7", 22, "main", "feature/ABC-7-footer-link");
    assert.equal(b.branch, "feature/ABC-7-footer-link-2");
    // Not a name git takes: the worker's own.
    assert.match(addWorktree(repo, "ABC-7", 23, "main", "feature/ABC 7 ..bad").branch, /^zeff\/ABC-7-w23/);
    assert.match(addWorktree(repo, "ABC-7", 24, "main").branch, /^zeff\/ABC-7-w24/);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
