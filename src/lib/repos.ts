import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { asc, eq, isNotNull, like, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Repo } from "@/db/schema";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { listJiraBoards } from "@/lib/jira/store";

const { repos, gitlabItems, jiraTickets } = schema;

/** A repo as the pages show it — and whether its folder is a git repo here, on which branch. */
export type RepoView = {
  id: number;
  name: string;
  path: string;
  gitlabProject: string | null;
  boards: number[];
  tickets: string[];
  instructions: string;
  /** mr: push a feature branch, open a merge request, merge once approved · direct: merge into the default branch and push. */
  delivery: "mr" | "direct";
  /** The folder is there and a git repo. */
  ok: boolean;
  branch: string | null;
};

const parse = <T>(json: string, fallback: T): T => {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
};

const isRepo = (dir: string) => !!dir && fs.existsSync(/*turbopackIgnore: true*/ path.join(dir, ".git"));

/** The branch checked out (read from .git/HEAD — no git call for a page). */
function branchOf(dir: string): string | null {
  try {
    const head = fs.readFileSync(/*turbopackIgnore: true*/ path.join(dir, ".git", "HEAD"), "utf8").trim();
    return head.startsWith("ref: refs/heads/") ? head.slice(16) : head.slice(0, 8);
  } catch {
    return null;
  }
}

function toView(r: Repo): RepoView {
  const ok = isRepo(r.path);
  return {
    id: r.id,
    name: r.name,
    path: r.path,
    gitlabProject: r.gitlabProject,
    boards: parse<number[]>(r.boards, []).filter(Number.isInteger),
    tickets: parse<string[]>(r.tickets, []).filter((t) => typeof t === "string"),
    instructions: r.instructions,
    delivery: r.delivery === "direct" ? "direct" : "mr",
    ok,
    branch: ok ? branchOf(r.path) : null,
  };
}

export function listRepos(): RepoView[] {
  return getDb().select().from(repos).orderBy(asc(repos.name)).all().map(toView);
}

export type RepoInput = { name: string; path: string; gitlabProject: string | null; boards: number[]; tickets: string[]; instructions: string; delivery: "mr" | "direct" };

const KEY = /^[A-Z][A-Z0-9]+-\d+$/;

function clean(input: RepoInput): RepoInput {
  const p = input.path.trim().replace(/^["']|["']$/g, "");
  if (!p) throw new ValidationError("The repo's folder is needed.");
  if (!isRepo(p)) throw new ValidationError(`${p} isn't a git repo (no .git there).`);
  const tickets = [...new Set(input.tickets.map((t) => t.trim().toUpperCase()).filter(Boolean))];
  const bad = tickets.find((t) => !KEY.test(t));
  if (bad) throw new ValidationError(`"${bad}" isn't a ticket key (like PROJ-321).`);
  return {
    name: input.name.trim() || path.basename(p),
    path: p,
    gitlabProject: input.gitlabProject?.trim() || null,
    boards: [...new Set(input.boards.filter(Number.isInteger))],
    tickets,
    instructions: input.instructions.trim().slice(0, 4000),
    delivery: input.delivery === "direct" ? "direct" : "mr",
  };
}

/** A new repo, or the one with this id changed. */
export function saveRepo(input: RepoInput, id?: number): RepoView {
  const v = clean(input);
  const values = { ...v, boards: JSON.stringify(v.boards), tickets: JSON.stringify(v.tickets) };
  const db = getDb();
  if (id) {
    const row = db.update(repos).set(values).where(eq(repos.id, id)).returning().get();
    if (!row) throw new NotFoundError("That repo isn't there any more.");
    return toView(row);
  }
  return toView(db.insert(repos).values(values).returning().get());
}

export function deleteRepo(id: number): void {
  getDb().delete(repos).where(eq(repos.id, id)).run();
}

/** Why a ticket's work goes to a repo: named there, its board's, or where its merge requests are. */
export type RepoMatch = { repo: RepoView; via: "ticket" | "board" | "gitlab" };

/**
 * The repo a ticket's work goes to: one that names the ticket, else the one its Jira board is
 * assigned to, else the one whose GitLab project its merge requests (and branches) are in. A
 * board with several repos: the one its merge requests are in, else the one whose checkout is
 * on a branch named after it, else the first.
 */
export function repoForTicket(ticket: string, all: RepoView[] = listRepos()): RepoMatch | null {
  const key = ticket.trim().toUpperCase();
  const usable = all.filter((r) => r.ok);
  const named = usable.find((r) => r.tickets.includes(key));
  if (named) return { repo: named, via: "ticket" };
  const projects = getDb()
    .selectDistinct({ project: gitlabItems.project })
    .from(gitlabItems)
    .where(or(like(gitlabItems.title, `%${key}%`), like(gitlabItems.branch, `%${key}%`)))
    .all()
    .map((r) => r.project);
  const hasMrs = (r: RepoView) => !!r.gitlabProject && projects.includes(r.gitlabProject);
  const board = getDb().select({ boardId: jiraTickets.boardId }).from(jiraTickets).where(sql`upper(${jiraTickets.key}) = ${key}`).get()?.boardId;
  const onBoard = board != null ? usable.filter((r) => r.boards.includes(board)) : [];
  if (onBoard.length) {
    const onItsBranch = (r: RepoView) => KEY.test(key) && !!r.branch && new RegExp(`(^|[^A-Za-z0-9])${key}(?![0-9])`, "i").test(r.branch);
    return { repo: onBoard.find(hasMrs) ?? onBoard.find(onItsBranch) ?? onBoard[0], via: "board" };
  }
  const inProject = usable.find(hasMrs);
  return inProject ? { repo: inProject, via: "gitlab" } : null;
}

/** The folders Claude Code knows (~/.claude.json) that are git repos. */
function knownFolders(): string[] {
  try {
    const j = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ path.join(os.homedir(), ".claude.json"), "utf8")) as { projects?: Record<string, unknown> };
    return [...new Set(Object.keys(j.projects ?? {}).map((p) => path.normalize(p)))].filter(isRepo);
  } catch {
    return [];
  }
}

/** What the Repos page offers: the GitLab projects the sync knows (with a folder here that looks like each), and the Jira boards. */
export function repoChoices(): {
  projects: { project: string; url: string; folder: string | null }[];
  boards: { id: number; name: string; enabled: boolean; projectKey: string | null }[];
} {
  const folders = knownFolders();
  const projects = getDb()
    .select({ project: gitlabItems.project, url: gitlabItems.projectUrl, n: sql<number>`count(*)` })
    .from(gitlabItems)
    .where(isNotNull(gitlabItems.project))
    .groupBy(gitlabItems.project)
    .orderBy(sql`count(*) desc`)
    .all()
    .map((p) => ({
      project: p.project,
      url: p.url,
      folder: folders.find((f) => path.basename(f).toLowerCase() === p.project.split("/").pop()!.toLowerCase()) ?? null,
    }));
  const boards = listJiraBoards().map((b) => ({ id: b.id, name: b.name, enabled: b.enabled, projectKey: b.projectKey }));
  return { projects, boards };
}

/** A repo's local branches, the most recently committed first (up to 50). */
export function localBranches(dir: string): string[] {
  try {
    return execFileSync("git", ["for-each-ref", "--sort=-committerdate", "--count=50", "--format=%(refname:short)", "refs/heads"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 15000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    })
      .split("\n")
      .map((b) => b.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

const branchCache = globalThis as unknown as { __zeffLocalBranches?: Map<string, { at: number; list: string[]; reading?: boolean }> };

/**
 * A repo's local branches for a page — as last read, never waited for: git is asked in the
 * background (at most once a minute), the Work tab refreshing once something changed.
 */
export function cachedLocalBranches(dir: string): string[] {
  const cache = (branchCache.__zeffLocalBranches ??= new Map());
  const hit = cache.get(dir);
  if ((!hit || Date.now() - hit.at >= 60000) && !hit?.reading) {
    cache.set(dir, { at: hit?.at ?? 0, list: hit?.list ?? [], reading: true });
    execFile("git", ["for-each-ref", "--sort=-committerdate", "--count=50", "--format=%(refname:short)", "refs/heads"], { cwd: dir, encoding: "utf8", timeout: 15000, windowsHide: true }, (err, out) => {
      const list = err ? (hit?.list ?? []) : String(out).split("\n").map((b) => b.trim()).filter(Boolean);
      cache.set(dir, { at: Date.now(), list });
      if (JSON.stringify(list) !== JSON.stringify(hit?.list ?? [])) void import("@/lib/events").then((m) => m.emitChange("branches"));
    });
  }
  return hit?.list ?? [];
}

/**
 * Switch a repo's checkout to one of its local branches (git switch — what's not committed
 * comes along, or git refuses and says why). The branch it's on afterwards.
 */
export function switchBranch(id: number, branch: string): string {
  const repo = listRepos().find((r) => r.id === id);
  if (!repo?.ok) throw new NotFoundError("That repo isn't there (or its folder is missing).");
  if (!localBranches(repo.path).includes(branch)) throw new ValidationError(`${branch} isn't a local branch of ${repo.name}.`);
  try {
    execFileSync("git", ["switch", branch], { cwd: repo.path, encoding: "utf8", timeout: 60000, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    throw new ValidationError(`git switch ${branch}: ${String(err.stderr || err.message).trim().slice(0, 400)}`);
  }
  return branchOf(repo.path) ?? branch;
}
