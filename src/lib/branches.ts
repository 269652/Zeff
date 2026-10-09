import { execFile, execFileSync } from "node:child_process";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { mergeGitlabMr, openGitlabMr } from "@/lib/gitlab/reply";
import { listGitlabItems } from "@/lib/gitlab/store";
import { getJiraTicket } from "@/lib/jira/store";
import { listRepos, type RepoView } from "@/lib/repos";
import { emitChange } from "@/lib/events";

/** What a local branch needs, the most pressing first. */
export type BranchState = "dirty" | "unpushed" | "ahead" | "no-mr" | "mr-open" | "merged" | "gone";

export type BranchItem = {
  repoId: number;
  repo: string;
  branch: string;
  ticket: string | null;
  state: BranchState;
  /** What to do, in words. */
  todo: string;
  /** Uncommitted files (checked out somewhere), commits not on origin. */
  dirty: number;
  ahead: number;
  mr: { iid: number; url: string } | null;
  /** Where it's checked out (the repo or a worktree), if anywhere. */
  checkedOutAt: string | null;
  lastCommit: string | null;
  /** No commit for 30 days. */
  stale: boolean;
  ignored: boolean;
};

const STALE_DAYS = 30;
const KEY = /(^|[^A-Za-z0-9])([A-Z][A-Z0-9]+-\d+)(?![0-9])/i;

const run = (cwd: string, args: string[]) => {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", timeout: 20000, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    return "";
  }
};
const gitAsync = (cwd: string, args: string[]) =>
  new Promise<string>((resolve, reject) =>
    execFile("git", args, { cwd, timeout: 180000, windowsHide: true }, (err, stdout, stderr) => (err ? reject(new Error(String(stderr || err.message).trim().slice(0, 500))) : resolve(String(stdout).trim()))),
  );

const ignoredOf = (repoId: number): string[] => {
  const r = getDb().select({ v: schema.repos.ignoredBranches }).from(schema.repos).where(eq(schema.repos.id, repoId)).get();
  try {
    return r ? (JSON.parse(r.v) as string[]) : [];
  } catch {
    return [];
  }
};

/** git, without blocking the server — at most a few at once (starting many stalls the server too): its output, or "" when it fails. */
let gitsRunning = 0;
const gitQueue: (() => void)[] = [];
const runAsync = async (cwd: string, args: string[]): Promise<string> => {
  if (gitsRunning >= 4) await new Promise<void>((go) => gitQueue.push(go));
  gitsRunning++;
  try {
    return await new Promise<string>((resolve) => execFile("git", args, { cwd, timeout: 20000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, out) => resolve(err ? "" : String(out).trim())));
  } finally {
    gitsRunning--;
    gitQueue.shift()?.();
  }
};

/** The repo's default branch on origin ("main"), and its remote ref ("origin/main"). */
async function defaultOf(dir: string): Promise<{ name: string; ref: string }> {
  const ref = (await runAsync(dir, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])) || "origin/main";
  return { name: ref.replace(/^origin\//, ""), ref };
}

/**
 * A repo's local branches as work: what each needs — uncommitted changes, commits to push, a
 * merge request to open (or merge), a merged branch to delete — read from git (as of the last
 * fetch) and the GitLab sync. The default branch isn't listed; ignored ones are marked.
 */
export async function branchWork(repo: RepoView): Promise<BranchItem[]> {
  if (!repo.ok) return [];
  const dir = repo.path;
  const def = await defaultOf(dir);
  const ignored = new Set(ignoredOf(repo.id));
  const merged = new Set((await runAsync(dir, ["branch", "--format=%(refname:short)", "--merged", def.ref])).split("\n").filter(Boolean));
  // Where each branch is checked out: the repo itself and its worktrees.
  const at = new Map<string, string>();
  let path = "";
  for (const line of (await runAsync(dir, ["worktree", "list", "--porcelain"])).split("\n")) {
    if (line.startsWith("worktree ")) path = line.slice(9).trim();
    else if (line.startsWith("branch refs/heads/")) at.set(line.slice(18).trim(), path);
  }
  const mrs = repo.gitlabProject ? listGitlabItems({ kind: "mr", limit: 500 }).filter((m) => m.project === repo.gitlabProject) : [];
  // The branches on origin by their commit — a local branch pushed under another name is found by it.
  const onOrigin = new Map<string, string[]>();
  for (const line of (await runAsync(dir, ["for-each-ref", "--format=%(objectname)%09%(refname:short)", "refs/remotes/origin"])).split("\n")) {
    const [sha, ref] = line.split("\t");
    if (sha && ref && ref !== "origin/HEAD") onOrigin.set(sha, [...(onOrigin.get(sha) ?? []), ref.replace(/^origin\//, "")]);
  }
  const cutoff = Date.now() - STALE_DAYS * 864e5;
  const lines = (await runAsync(dir, ["for-each-ref", "--sort=-committerdate", "--count=80", "--format=%(refname:short)%09%(upstream:short)%09%(upstream:track)%09%(committerdate:iso-strict)%09%(objectname)", "refs/heads"])).split("\n");
  // What git has to be asked per branch (a worktree's status, how far ahead) — all at once, not one by one.
  const facts = await Promise.all(
    lines.map(async (line) => {
      const [branch, upstream, track] = line.split("\t");
      if (!branch || branch === def.name) return { dirty: 0, ahead: 0 };
      const checkedOutAt = at.get(branch) ?? null;
      const [status, count] = await Promise.all([
        checkedOutAt ? runAsync(checkedOutAt, ["status", "--porcelain"]) : Promise.resolve(""),
        upstream ? Promise.resolve(/ahead (\d+)/.exec(track ?? "")?.[1] ?? "0") : runAsync(dir, ["rev-list", "--count", `${def.ref}..${branch}`]),
      ]);
      return { dirty: status.split("\n").filter(Boolean).length, ahead: Number(count) || 0 };
    }),
  );
  const out: BranchItem[] = [];
  for (const [i, line] of lines.entries()) {
    const [branch, upstream, track, date, sha] = line.split("\t");
    if (!branch || branch === def.name) continue;
    const checkedOutAt = at.get(branch) ?? null;
    const { dirty, ahead } = facts[i];
    // Its merge request: by its name here or on origin (a worker's branch is pushed as feature/…).
    const names = new Set([branch, upstream?.replace(/^origin\//, ""), ...(onOrigin.get(sha ?? "") ?? [])].filter(Boolean));
    const mine = mrs.filter((m) => m.branch && names.has(m.branch));
    const mr = mine.find((m) => m.state?.includes("opened")) ?? mine.find((m) => m.state?.includes("merged")) ?? mine[0];
    const mrInfo = mr ? { iid: Number(mr.ref.replace("!", "")), url: mr.url } : null;
    let state: BranchState;
    let todo: string;
    if (dirty) [state, todo] = ["dirty", `${dirty} Datei${dirty === 1 ? "" : "en"} nicht committet`];
    else if (merged.has(branch) || mr?.state?.includes("merged")) [state, todo] = ["merged", `In ${def.name} gemergt — lokal löschen`];
    else if (!upstream && ahead) [state, todo] = ["unpushed", `${ahead} Commit${ahead === 1 ? "" : "s"} nur lokal — pushen`];
    else if (!upstream) continue; // nothing of its own: nothing to do
    else if (/gone/.test(track ?? "")) [state, todo] = ["gone", "Auf origin gelöscht — lokal löschen?"];
    else if (ahead) [state, todo] = ["ahead", `${ahead} Commit${ahead === 1 ? "" : "s"} noch nicht gepusht`];
    else if (mr?.state?.includes("opened")) [state, todo] = ["mr-open", `${mr.ref} offen — nach ${def.name} mergen`];
    else [state, todo] = ["no-mr", `Gepusht, ohne Merge Request — MR nach ${def.name} öffnen`];
    out.push({
      repoId: repo.id,
      repo: repo.name,
      branch,
      ticket: KEY.exec(branch)?.[2]?.toUpperCase() ?? null,
      state,
      todo,
      dirty,
      ahead,
      mr: mrInfo,
      checkedOutAt,
      lastCommit: date || null,
      stale: !!date && Date.parse(date) < cutoff,
      ignored: ignored.has(branch),
    });
  }
  return out;
}

const cache = globalThis as { __zeffBranchWork?: { at: number; items: BranchItem[] }; __zeffBranchWorkReading?: Promise<void> };

/**
 * Every repo's branch work, as last read — never waited for: git is asked in the background (at
 * most once a minute, at once again after a change) and the pages refresh once it's read. Until
 * the first read: none.
 */
export function allBranchWork(): BranchItem[] {
  const hit = cache.__zeffBranchWork;
  if ((!hit || Date.now() - hit.at >= 60000) && !cache.__zeffBranchWorkReading) {
    cache.__zeffBranchWorkReading = Promise.all(listRepos().map((r) => branchWork(r)))
      .then((lists) => {
        const items = lists.flat();
        // Told only when something changed — and only to the Work tab (its own topic).
        const changed = JSON.stringify(items) !== JSON.stringify(hit?.items ?? null);
        cache.__zeffBranchWork = { at: Date.now(), items };
        if (changed) emitChange("branches");
      })
      .catch(() => {})
      .finally(() => {
        cache.__zeffBranchWorkReading = undefined;
      });
  }
  return hit?.items ?? [];
}

/** Read the branches again (after a push, a switch, a delete …) — what was read stays shown till then. */
export const forgetBranchWork = () => {
  if (cache.__zeffBranchWork) cache.__zeffBranchWork.at = 0;
};

export type BranchOp = "push" | "open-mr" | "merge" | "delete" | "ignore" | "unignore" | "ignore-stale";

/** Do what a branch needs (on your click): push it, open or merge its MR, delete it — or (not) list it any more. What happened. */
export async function branchOp(repoId: number, branch: string, op: BranchOp): Promise<string> {
  try {
    return await doBranchOp(repoId, branch, op);
  } finally {
    forgetBranchWork();
  }
}

async function doBranchOp(repoId: number, branch: string, op: BranchOp): Promise<string> {
  const repo = listRepos().find((r) => r.id === repoId);
  if (!repo?.ok) throw new NotFoundError("That repo isn't there (or its folder is missing).");
  const save = (list: string[]) => getDb().update(schema.repos).set({ ignoredBranches: JSON.stringify([...new Set(list)].sort()) }).where(eq(schema.repos.id, repoId)).run();
  if (op === "ignore-stale") {
    const stale = (await branchWork(repo)).filter((b) => b.stale && !b.ignored).map((b) => b.branch);
    save([...ignoredOf(repoId), ...stale]);
    return `${stale.length} alte Branch${stale.length === 1 ? "" : "es"} ausgeblendet.`;
  }
  if (op === "ignore" || op === "unignore") {
    const list = ignoredOf(repoId).filter((b) => b !== branch);
    save(op === "ignore" ? [...list, branch] : list);
    return op === "ignore" ? `${branch} ausgeblendet.` : `${branch} wieder eingeblendet.`;
  }
  const item = (await branchWork(repo)).find((b) => b.branch === branch);
  if (!item) throw new ValidationError(`${branch} has nothing to do (any more).`);
  const def = await defaultOf(repo.path);
  if (op === "push") {
    await gitAsync(repo.path, ["push", "-u", "origin", `${branch}:${branch}`]);
    return `${branch} gepusht.`;
  }
  if (op === "delete") {
    if (item.checkedOutAt) throw new ValidationError(`${branch} is checked out (${item.checkedOutAt}) — switch away (or remove that worktree) first.`);
    await gitAsync(repo.path, ["branch", item.state === "merged" ? "-d" : "-D", branch]);
    return `${branch} gelöscht (lokal).`;
  }
  if (!repo.gitlabProject) throw new ValidationError(`${repo.name} has no GitLab project — set it on the Repos page.`);
  if (op === "merge") {
    if (!item.mr) throw new ValidationError(`${branch} has no merge request.`);
    const r = await mergeGitlabMr(repo.gitlabProject, item.mr.iid);
    return r.already ? `!${item.mr.iid} war schon gemergt.` : `!${item.mr.iid} gemergt: ${r.url}`;
  }
  const summary = item.ticket ? getJiraTicket(item.ticket)?.summary : undefined;
  const log = run(repo.path, ["log", "--oneline", "--no-decorate", `${def.ref}..${branch}`]);
  // From the branch as it's on origin (a worker's is pushed under another name).
  const upstream = run(repo.path, ["rev-parse", "--abbrev-ref", `${branch}@{upstream}`]).replace(/^origin\//, "");
  const mr = await openGitlabMr({
    project: repo.gitlabProject,
    sourceBranch: upstream || branch,
    targetBranch: def.name,
    title: item.ticket ? `${item.ticket}: ${summary ?? branch}` : branch,
    description: log ? `Commits:\n${log}` : "",
  });
  return mr.existed ? `Es gibt schon einen offenen MR: ${mr.url}` : `MR geöffnet: ${mr.url}`;
}
