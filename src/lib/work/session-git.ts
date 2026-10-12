import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { WorkRun } from "@/db/schema";
import { gitFailure } from "@/lib/git";
import { listRepos } from "@/lib/repos";
import { workRef } from "./shared";
import { t } from "@/lib/i18n/server";

/**
 * A session's work as git sees it — what Claude Code's diff view shows: every file changed since
 * the session began (committed or not, new files too), and the steps after it — commit, push, a
 * merge request. Each one your click; nothing here runs on its own.
 */

const gitAsync = (cwd: string, args: string[], timeoutMs = 120000) =>
  new Promise<string>((resolve, reject) =>
    execFile("git", args, { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) =>
      err ? reject(gitFailure(err, String(stderr || err.message).trim().slice(0, 800))) : resolve(String(stdout)),
    ),
  );

export type DiffFile = { path: string; status: "added" | "modified" | "deleted" | "renamed" | "untracked"; added: number; removed: number; patch: string; binary: boolean };

const MAX_PATCH = 400000;

function where(run: Pick<WorkRun, "cwd" | "id">): string {
  if (!run.cwd || !fs.existsSync(/*turbopackIgnore: true*/ path.join(run.cwd, ".git"))) throw new Error(t("{ref} doesn't work in a git repository.", { ref: workRef(run.id) }));
  return run.cwd;
}

/** Everything changed since the session's start (its base), file by file. */
export async function sessionDiff(run: Pick<WorkRun, "cwd" | "id" | "baseSha">): Promise<{ base: string; files: DiffFile[]; truncated: boolean }> {
  const cwd = where(run);
  const base = run.baseSha || (await gitAsync(cwd, ["rev-parse", "HEAD"])).trim();
  const raw = await gitAsync(cwd, ["diff", "--no-color", "--find-renames", "-U3", base]);
  const files: DiffFile[] = [];
  let truncated = false;
  for (const chunk of raw.split(/^(?=diff --git )/m)) {
    if (!chunk.startsWith("diff --git ")) continue;
    const head = /^diff --git a\/(.+?) b\/(.+)$/m.exec(chunk);
    const status: DiffFile["status"] = /^new file mode/m.test(chunk) ? "added" : /^deleted file mode/m.test(chunk) ? "deleted" : /^rename from/m.test(chunk) ? "renamed" : "modified";
    const body = chunk.split("\n");
    const added = body.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
    const removed = body.filter((l) => l.startsWith("-") && !l.startsWith("---")).length;
    files.push({ path: head?.[2] ?? "?", status, added, removed, patch: chunk.slice(0, MAX_PATCH), binary: /^Binary files /m.test(chunk) });
  }
  // New files git doesn't track yet: all theirs added.
  const untracked = (await gitAsync(cwd, ["ls-files", "--others", "--exclude-standard"])).split("\n").filter(Boolean).slice(0, 200);
  for (const f of untracked) {
    let text = "";
    let binary = false;
    try {
      const buf = fs.readFileSync(/*turbopackIgnore: true*/ path.join(cwd, f));
      binary = buf.subarray(0, 8000).includes(0);
      text = binary ? "" : buf.toString("utf8").slice(0, MAX_PATCH);
    } catch {
      // gone meanwhile
    }
    const lines = text ? text.replace(/\n$/, "").split("\n") : [];
    files.push({ path: f, status: "untracked", added: lines.length, removed: 0, patch: binary ? "" : `@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join("\n")}`, binary });
  }
  let total = 0;
  for (const f of files) {
    total += f.patch.length;
    if (total > 4 * MAX_PATCH) {
      f.patch = "";
      truncated = true;
    }
  }
  return { base, files, truncated };
}

/** Commit everything (all changes, new files too) with your message. */
export async function commitSession(run: Pick<WorkRun, "cwd" | "id">, message: string): Promise<string> {
  const cwd = where(run);
  if (!message.trim()) throw new Error(t("A commit needs a message."));
  await gitAsync(cwd, ["add", "-A"]);
  await gitAsync(cwd, ["commit", "-m", message.trim()]);
  return (await gitAsync(cwd, ["log", "-1", "--oneline", "--no-decorate"])).trim();
}

/** Push the session's branch to origin (with upstream). Returns the branch pushed. */
export async function pushSession(run: Pick<WorkRun, "cwd" | "id">): Promise<string> {
  const cwd = where(run);
  const branch = (await gitAsync(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  if (!branch || branch === "HEAD") throw new Error(t("Not on a branch (detached HEAD) — nothing to push."));
  await gitAsync(cwd, ["push", "-u", "origin", branch], 300000);
  return branch;
}

/** A merge request for the session's (pushed) branch into the repo's default branch — through GitLab (the automation Chrome). */
export async function openSessionMr(run: Pick<WorkRun, "cwd" | "id" | "repo" | "ticket" | "summary">, title: string): Promise<{ url?: string; existed?: boolean }> {
  const cwd = where(run);
  const repo = listRepos().find((r) => r.path === run.repo);
  if (!repo?.gitlabProject) throw new Error(t("The repo has no GitLab project (Repos page) — open the merge request yourself."));
  const branch = (await gitAsync(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  const target = (await gitAsync(cwd, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).catch(() => "origin/main")).trim().replace(/^origin\//, "") || "main";
  const { openGitlabMr } = await import("@/lib/gitlab/reply");
  return openGitlabMr({ project: repo.gitlabProject, sourceBranch: branch, targetBranch: target, title: title.trim() || `${run.ticket}: ${branch}`, description: `${run.summary ?? ""}\n\nZeff ${workRef(run.id)}`.trim() });
}

/** Files in the session's folder matching what you type after @ (git's list: tracked and new, not ignored). */
export async function sessionFiles(run: Pick<WorkRun, "cwd" | "id">, q: string): Promise<string[]> {
  if (!run.cwd) return [];
  const isGit = fs.existsSync(/*turbopackIgnore: true*/ path.join(run.cwd, ".git"));
  const all = isGit
    ? (await gitAsync(run.cwd, ["ls-files", "--cached", "--others", "--exclude-standard"]).catch(() => "")).split("\n").filter(Boolean)
    : fs.readdirSync(/*turbopackIgnore: true*/ run.cwd).slice(0, 500);
  const needle = q.toLowerCase().replace(/\\/g, "/");
  const hits = needle ? all.filter((f) => f.toLowerCase().includes(needle)) : all;
  // Name matches first, then shorter paths.
  return hits
    .sort((a, b) => Number(!path.basename(b).toLowerCase().includes(needle)) - Number(!path.basename(a).toLowerCase().includes(needle)) || a.length - b.length)
    .slice(0, 30);
}
