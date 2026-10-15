import { eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { TodoOp, TodoView } from "@/lib/boards/shared";
import { getTodo, recordBranch } from "@/lib/boards/store";
import { listRepos } from "@/lib/repos";
import { repoWebUrl } from "./remote";

const { gitlabItems, todos, workRuns } = schema;

/** The branches a todo's work and delivery name: the ones its operations and its planned steps' operations push, merge or open a merge request from. */
export function branchNamesOf(todo: Pick<TodoView, "ops" | "planned">): string[] {
  const names = new Set<string>();
  const add = (ops: TodoOp[]) => {
    for (const o of ops) {
      if (o.type === "git-push") names.add(o.remote);
      else if (o.type === "gitlab-open-mr") names.add(o.source);
      else if (o.type === "git-merge-main" || o.type === "git-commit-branch") names.add(o.branch);
    }
  };
  add(todo.ops);
  for (const p of todo.planned) for (const s of p.steps) add(s.ops);
  return [...names].map((n) => n.replace(/^origin\//, "")).filter(Boolean);
}

/** A branch or merge request a todo is linked to, as the worker is told of it. */
export type LinkedBranch = { branch: string; label: string; url: string };

/**
 * The branches the todo's context names: its linked branches and the source branches of its linked
 * merge requests (or of the merge request a linked comment is on) — not a worker's own zeff/… branch,
 * not a merge request that is merged or closed already.
 */
export function linkedBranchesOf(todo: Pick<TodoView, "refs">): LinkedBranch[] {
  const keys = todo.refs.filter((r) => r.startsWith("gitlab:")).map((r) => r.slice("gitlab:".length));
  if (!keys.length) return [];
  const db = getDb();
  const rows = db.select().from(gitlabItems).where(inArray(gitlabItems.key, keys)).all();
  const parents = rows.map((r) => r.parent).filter((p): p is string => !!p && !keys.includes(p));
  if (parents.length) rows.push(...db.select().from(gitlabItems).where(inArray(gitlabItems.key, parents)).all());
  const out = new Map<string, LinkedBranch>();
  for (const r of rows) {
    if ((r.kind !== "mr" && r.kind !== "branch") || !r.branch || !shown(r.branch)) continue;
    if (r.kind === "mr" && /merged|closed/i.test(r.state ?? "")) continue;
    const mr = r.kind === "mr";
    const prev = out.get(r.branch);
    if (prev && !mr) continue;
    out.set(r.branch, { branch: r.branch, label: mr ? `Merge Request ${r.ref}` : "Branch", url: r.url });
  }
  return [...out.values()];
}

/** A todo's work chain: the todos it follows up on (up to the one a worker did the work on) and everything that follows from it (follow-ups, theirs …). */
function family(id: number): number[] {
  const out = new Set<number>([id]);
  for (let at = getDb().select({ p: todos.parentId }).from(todos).where(eq(todos.id, id)).get()?.p ?? null, i = 0; at && !out.has(at) && i < 20; i++) {
    out.add(at);
    at = getDb().select({ p: todos.parentId }).from(todos).where(eq(todos.id, at)).get()?.p ?? null;
  }
  for (let frontier = [...out], i = 0; frontier.length && i < 20; i++) {
    const kids = getDb().select({ id: todos.id }).from(todos).where(inArray(todos.parentId, frontier)).all().map((r) => r.id).filter((k) => !out.has(k));
    for (const k of kids) out.add(k);
    frontier = kids;
  }
  return [...out];
}

/** A branch named in a todo's text. */
const BRANCH_IN_TEXT = /\b((?:feature|fix|bugfix|hotfix)\/[A-Za-z0-9._\-/]+)/;

/** A branch of a work run that's worth showing: a feature or fix branch — not a worker's own worktree branch (zeff/…). */
const shown = (name: string) => !!name && !name.startsWith("zeff/");

/**
 * A branch Zeff knows of — a worker made it, GitLab may not have it (yet) — as a "branch" item
 * of GitLab (with its address), so it can be context. Not again when there's one; the GitLab sync's
 * own copy of it (same key) replaces this one.
 */
function noteBranch(repoPath: string, name: string): void {
  const repo = listRepos().find((r) => r.path === repoPath);
  const web = repoWebUrl(repoPath);
  if (!repo?.gitlabProject || !web) return;
  getDb()
    .insert(gitlabItems)
    .values({
      key: `branch:${repo.gitlabProject}:${name}`,
      kind: "branch",
      project: repo.gitlabProject,
      projectUrl: web,
      ref: name,
      title: name,
      body: "",
      url: `${web}/-/tree/${name}`,
      branch: name,
      state: "not pushed",
      syncedAt: new Date().toISOString(),
    })
    .onConflictDoNothing()
    .run();
}

/**
 * Record which branches a todo's work is on — from its runs, its delivery operations and its
 * follow-ups — as a relation of its own (todo_links): its GitLab branch and merge request are
 * its context from then on, whatever happens to the todo (see linkedRefs in the store). A branch
 * GitLab hasn't synced yet is noted from what Zeff knows (marked "not pushed"; the sync replaces
 * it). Called when work finishes and after each GitLab sync. How many relations were new.
 */
export function linkBranchContext(todoIds: number[]): number {
  let added = 0;
  for (const id of new Set(todoIds)) {
    const todo = getTodo(id);
    if (!todo || todo.status !== "open") continue;
    const ids = family(id);
    const found = new Map<string, string | null>();
    for (const m of ids) {
      const t = m === id ? todo : getTodo(m);
      if (!t) continue;
      for (const n of branchNamesOf(t)) if (shown(n)) found.set(n, found.get(n) ?? null);
      // A todo that names the branch in its words (a delivery: "Merge Request für feature/… öffnen").
      const named = BRANCH_IN_TEXT.exec(t.text)?.[1]?.replace(/[.\-/]+$/, "");
      if (named && shown(named)) found.set(named, found.get(named) ?? null);
    }
    const runs = getDb().select({ repo: workRuns.repo, branch: workRuns.branch }).from(workRuns).where(inArray(workRuns.todoId, ids)).all().filter((r) => r.repo && r.branch);
    for (const r of runs) {
      const name = r.branch!.replace(/^origin\//, "");
      if (!shown(name)) continue;
      found.set(name, r.repo);
      noteBranch(r.repo!, name);
    }
    for (const [name, repo] of found) if (recordBranch(id, name, repo, "run")) added++;
  }
  return added;
}
