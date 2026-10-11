import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

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
  if (commits) parts.push(`Commits:\n${commits}`);
  const stat = baseSha ? tryGit(cwd, ["diff", "--stat", baseSha]) : "";
  if (stat) parts.push(`Geändert seit Start:\n${stat}`);
  const status = tryGit(cwd, ["status", "--short"]);
  if (status) parts.push(`Nicht committet:\n${status}`);
  return parts.join("\n\n").slice(0, 6000);
}

/** The git repo a folder is in: its top folder (null: not in one). */
export function repoRoot(folder: string): string | null {
  if (!folder || !fs.existsSync(/*turbopackIgnore: true*/ folder)) return null;
  const top = tryGit(folder, ["rev-parse", "--show-toplevel"]);
  return top ? path.resolve(top) : null;
}

export type BranchInfo = {
  /** Local name; a branch only on the remote: its name without "origin/". */
  name: string;
  /** Only on the remote so far (a local tracking branch is made when it is used). */
  remote: boolean;
  /** Checked out in the folder asked about. */
  current: boolean;
  /** Checked out in another worktree (it can't be checked out twice): that folder. */
  worktree: string | null;
};

/** The branches of a repo (newest first) and which are checked out where — worktrees included. `folder`: the checkout asked about (a worktree's own folder, or the repo). */
export function listBranches(folder: string): { current: string | null; branches: BranchInfo[] } {
  const here = path.resolve(folder);
  const used = new Map<string, string>();
  let dir = "";
  for (const line of tryGit(folder, ["worktree", "list", "--porcelain"]).split("\n")) {
    if (line.startsWith("worktree ")) dir = path.resolve(line.slice(9).trim());
    else if (line.startsWith("branch refs/heads/")) used.set(line.slice(18).trim(), dir);
  }
  const current = tryGit(folder, ["symbolic-ref", "--short", "-q", "HEAD"]) || null;
  const out: BranchInfo[] = [];
  const seen = new Set<string>();
  const refs = tryGit(folder, ["for-each-ref", "--sort=-committerdate", "--format=%(refname)", "refs/heads", "refs/remotes"]).split("\n").map((r) => r.trim()).filter(Boolean);
  // Local branches first, then those only on a remote.
  for (const remote of [false, true]) {
    for (const ref of refs) {
      const isRemote = ref.startsWith("refs/remotes/");
      if (isRemote !== remote) continue;
      const name = isRemote ? ref.replace(/^refs\/remotes\/[^/]+\//, "") : ref.replace(/^refs\/heads\//, "");
      if (!name || name === "HEAD" || seen.has(name)) continue;
      seen.add(name);
      const wt = used.get(name) ?? null;
      out.push({ name, remote: isRemote, current: name === current && (!wt || wt === here), worktree: wt && wt !== here ? wt : null });
    }
  }
  return { current, branches: out.slice(0, 400) };
}

/** Where git's hooks are switched off for what Zeff does in a fresh folder (see addWorktree). */
function noHooksFor(dir: string): string {
  const d = path.join(path.dirname(dir), ".no-hooks");
  fs.mkdirSync(/*turbopackIgnore: true*/ d, { recursive: true });
  return d;
}

/**
 * A worktree on an existing branch (the work goes on that branch, in a folder of its own): a
 * branch only on the remote gets a local one tracking it. A branch already checked out elsewhere
 * can't be — the error says where.
 */
export function addBranchWorktree(repo: string, branch: string, runId: number): { cwd: string; branch: string; baseSha: string } {
  const info = listBranches(repo).branches.find((b) => b.name === branch);
  if (!info) throw new Error(`Branch ${branch} doesn't exist in ${repo}.`);
  const holder = info.worktree ?? (info.current ? repo : null);
  if (holder) throw new Error(`Branch ${branch} is checked out in ${holder} already - pick another, or start a new branch from it.`);
  const safe = branch.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 60);
  let cwd = path.join(path.dirname(repo), ".zeff-worktrees", `${path.basename(repo)}-${safe}-w${runId}`);
  for (let n = 2; fs.existsSync(/*turbopackIgnore: true*/ cwd) && n < 20; n++) cwd = path.join(path.dirname(repo), ".zeff-worktrees", `${path.basename(repo)}-${safe}-w${runId}-${n}`);
  fs.mkdirSync(/*turbopackIgnore: true*/ path.dirname(cwd), { recursive: true });
  const hooks = ["-c", `core.hooksPath=${noHooksFor(cwd)}`];
  try {
    if (info.remote) git(repo, [...hooks, "worktree", "add", "--quiet", "--track", "-b", branch, cwd, `origin/${branch}`], 300000);
    else git(repo, [...hooks, "worktree", "add", "--quiet", cwd, branch], 300000);
  } catch (e) {
    tryGit(repo, ["worktree", "remove", "--force", cwd]);
    throw e;
  }
  return { cwd, branch, baseSha: git(cwd, ["rev-parse", "HEAD"]) };
}

/**
 * Switch the branch of a checkout (the session's worktree, or the repo): only when nothing is
 * uncommitted and the branch isn't checked out in another worktree. Returns the branch now.
 */
export function switchBranch(cwd: string, branch: string): string {
  const { branches, current } = listBranches(cwd);
  const info = branches.find((b) => b.name === branch);
  if (!info) throw new Error(`Branch ${branch} doesn't exist.`);
  if (info.worktree) throw new Error(`Branch ${branch} is checked out in ${info.worktree} - it can't be checked out twice.`);
  if (current === branch) return branch;
  const dirty = tryGit(cwd, ["status", "--porcelain"]);
  if (dirty) throw new Error(`There are uncommitted changes in ${cwd} - commit or stash them first:\n${dirty.split("\n").slice(0, 6).join("\n")}`);
  git(cwd, ["-c", `core.hooksPath=${noHooksFor(cwd)}`, "switch", "--quiet", branch], 120000);
  return tryGit(cwd, ["symbolic-ref", "--short", "-q", "HEAD"]) || branch;
}
