import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();

/** A stand-in for the Claude CLI: answers with a finished result at once (no model). */
const FAKE_CLI = [
  "process.stdin.resume();",
  "process.stdin.on('end', () => {",
  "  const out = { outcome: 'done', summary: 'ok', entry: 'ok', completedTodos: [], followUps: [] };",
  "  console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, structured_output: out, result: 'ok', session_id: 's', num_turns: 1, total_cost_usd: 0 }));",
  "});",
].join("\n");

async function waitDone(id: number) {
  const { getRun } = await import("@/lib/work/store");
  for (let i = 0; i < 300; i++) {
    const r = getRun(id)!;
    if (r.status !== "queued" && r.status !== "running") return r;
    await new Promise((res) => setTimeout(res, 100));
  }
  assert.fail("run didn't finish");
}

test("a session works where you picked: another folder, a new branch from a chosen one, the chosen branch itself, or in place", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-ws-"));
  const cli = path.join(base, "fake-claude.js");
  fs.writeFileSync(cli, FAKE_CLI);
  process.env.CLAUDE_CLI = cli;
  delete process.env.ZEFF_WORK_HOST; // the server starts the worker itself
  const repo = path.join(base, "app");
  fs.mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "t@example.com");
  git(repo, "config", "user.name", "T");
  fs.writeFileSync(path.join(repo, "a.txt"), "a");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "init");
  for (const b of ["feature/x", "other", "third"]) git(repo, "branch", b);
  try {
    const { setInstalled } = await import("@/plugins/state");
    for (const p of ["work", "llm", "claude-cli"] as const) setInstalled(p, true);
    const { addSessionTodo } = await import("@/lib/boards/store");
    const { dispatchTodo } = await import("@/lib/work/runner");
    const start = async (opts: Parameters<typeof dispatchTodo>[1]) => {
      const t = addSessionTodo({ ticket: "ABC-9", text: "Work somewhere" });
      return waitDone(dispatchTodo(t.id, { instruction: "go", ...opts }).id);
    };

    // Not a git repo: refused.
    const t0 = addSessionTodo({ ticket: "ABC-9", text: "x" });
    assert.throws(() => dispatchTodo(t0.id, { instruction: "go", repoPath: base }), /isn't in a git repo/);

    // A new branch from the chosen one, in a worktree (a sub-folder of the repo is enough to name it).
    const a = await start({ repoPath: path.join(repo), branch: "other", workspace: "worktree" });
    assert.equal(a.status, "done", a.error ?? "");
    assert.equal(a.base, "other");
    assert.match(a.branch ?? "", /^zeff\/ABC-9-w/);
    assert.ok(a.cwd!.includes(".zeff-worktrees"));
    assert.equal(a.workspace, "worktree");

    // The chosen branch itself, in a worktree of its own - no delivery proposed behind your back.
    const b = await start({ repoPath: repo, branch: "feature/x", workspace: "branch" });
    assert.equal(b.status, "done", b.error ?? "");
    assert.equal(b.branch, "feature/x");
    assert.equal(git(b.cwd!, "symbolic-ref", "--short", "HEAD"), "feature/x");
    assert.notEqual(path.resolve(b.cwd!), path.resolve(repo));

    // In place, on another branch: the checkout itself is switched.
    const c = await start({ repoPath: repo, branch: "third", workspace: "checkout" });
    assert.equal(c.status, "done", c.error ?? "");
    assert.equal(path.resolve(c.cwd!), path.resolve(repo));
    assert.equal(git(repo, "symbolic-ref", "--short", "HEAD"), "third");

    // The same branch twice (it's checked out in a worktree already): the run fails with the reason.
    const d = await start({ repoPath: repo, branch: "feature/x", workspace: "branch" });
    assert.equal(d.status, "failed");
    assert.match(d.error ?? "", /checked out in .* already/);
  } finally {
    delete process.env.CLAUDE_CLI;
    fs.rmSync(base, { recursive: true, force: true });
  }
});
