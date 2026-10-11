import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { t } from "@/lib/i18n/server";

/** git in a folder: its output (trimmed), or throws with what git said. */
export function git(cwd: string, args: string[], timeoutMs = 60000): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", timeout: timeoutMs, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();
}

const tryGit = (cwd: string, args: string[]) => {
  try {
    return git(cwd, args);
  } catch {
    return "";
  }
};

const isRepo = (dir: string) => fs.existsSync(/*turbopackIgnore: true*/ path.join(dir, ".git"));

/**
 * Where a worker on a ticket starts from: the ticket's own branch (the newest local or remote
 * branch with its key in the name — the merge request's), else the repo's default branch
 * (origin/HEAD), else what's checked out.
 */
export function baseFor(repo: string, ticket: string): string {
  const refs = tryGit(repo, ["for-each-ref", "--sort=-committerdate", "--format=%(refname:short)", "refs/heads", "refs/remotes"])
    .split("\n")
    .map((r) => r.trim())
    .filter(Boolean);
  const key = new RegExp(`(^|[^A-Za-z0-9])${ticket}(?![0-9])`, "i");
  // Not another worker's branch (zeff/…, also as pushed: origin/zeff/…).
  const own = refs.find((r) => key.test(r) && !/^(origin\/)?zeff\//.test(r));
  if (own) return own;
  const head = tryGit(repo, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  return head || "HEAD";
}

/**
 * A worktree of its own for a run: a new branch zeff/<ticket>-w<id> from `base`, in a folder
 * next to the repo (<parent>/.zeff-worktrees/<repo>-w<id>) — the checkout and what's in progress
 * there stay untouched.
 */
export function addWorktree(repo: string, ticket: string, runId: number, base: string): { cwd: string; branch: string; baseSha: string } {
  const baseSha = git(repo, ["rev-parse", base]);
  // A name already taken (a branch or folder left from before): the next free one.
  const taken = (b: string, dir: string) => !!tryGit(repo, ["rev-parse", "--verify", "--quiet", `refs/heads/${b}`]) || fs.existsSync(/*turbopackIgnore: true*/ dir);
  const name = (n: number) => (n ? `-w${runId}-${n + 1}` : `-w${runId}`);
  let n = 0;
  while (taken(`zeff/${ticket}${name(n)}`, path.join(path.dirname(repo), ".zeff-worktrees", `${path.basename(repo)}${name(n)}`)) && n < 20) n++;
  const branch = `zeff/${ticket}${name(n)}`;
  const cwd = path.join(path.dirname(repo), ".zeff-worktrees", `${path.basename(repo)}${name(n)}`);
  fs.mkdirSync(/*turbopackIgnore: true*/ path.dirname(cwd), { recursive: true });
  // Without the repo's hooks: a post-checkout hook (CaptainHook: vendor/bin/captainhook) fails in
  // a fresh worktree that has no vendor yet — and would fail the whole checkout with it.
  const noHooks = path.join(path.dirname(cwd), ".no-hooks");
  fs.mkdirSync(/*turbopackIgnore: true*/ noHooks, { recursive: true });
  try {
    git(repo, ["-c", `core.hooksPath=${noHooks}`, "worktree", "add", "--quiet", "-b", branch, cwd, baseSha], 300000);
  } catch (e) {
    // Half made: gone again, so the next try starts clean.
    tryGit(repo, ["worktree", "remove", "--force", cwd]);
    tryGit(repo, ["branch", "-D", branch]);
    throw e;
  }
  return { cwd, branch, baseSha };
}

/** What a run changed, as git sees it now: commits since it started, and files not committed. */
export function gitSummary(cwd: string, baseSha: string | null): string {
  if (!cwd || !isRepo(cwd)) return ""; // a worktree's .git is a file: there too
  const parts: string[] = [];
  const commits = baseSha ? tryGit(cwd, ["log", "--oneline", "--no-decorate", `${baseSha}..HEAD`]) : "";
  if (commits) parts.push(`${t("Commits:")}\n${commits}`);
  const stat = baseSha ? tryGit(cwd, ["diff", "--stat", baseSha]) : "";
  if (stat) parts.push(`${t("Changed since the start:")}\n${stat}`);
  const status = tryGit(cwd, ["status", "--short"]);
  if (status) parts.push(`${t("Not committed:")}\n${status}`);
  return parts.join("\n\n").slice(0, 6000);
}
