import { eq, inArray, or } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { TodoOp, TodoView } from "@/lib/boards/shared";
import { addTodoContext, getTodo } from "@/lib/boards/store";
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
 * A todo's feature branch and merge request as context — linked: the branches its work made (its
 * runs') and its delivery names (also in its follow-ups), and the merge requests from them, as
 * GitLab items in the todo's context, each once. A branch GitLab hasn't synced yet is noted from
 * what Zeff knows (marked "not pushed"; the sync replaces it). The GitLab sync calls this again,
 * so a merge request that appears later joins. How many were added.
 */
export function linkBranchContext(todoIds: number[]): number {
  let added = 0;
  for (const id of new Set(todoIds)) {
    const todo = getTodo(id);
    if (!todo || todo.status !== "open") continue;
    const ids = family(id);
    const names = new Set<string>();
    for (const m of ids) {
      const t = m === id ? todo : getTodo(m);
      if (t) for (const n of branchNamesOf(t)) if (shown(n)) names.add(n);
    }
    const runs = getDb().select({ repo: workRuns.repo, branch: workRuns.branch }).from(workRuns).where(inArray(workRuns.todoId, ids)).all().filter((r) => r.repo && r.branch);
    for (const r of runs) {
      const name = r.branch!.replace(/^origin\//, "");
      if (!shown(name)) continue;
      names.add(name);
      noteBranch(r.repo!, name);
    }
    if (!names.size) continue;
    const items = getDb()
      .select({ key: gitlabItems.key, kind: gitlabItems.kind })
      .from(gitlabItems)
      .where(or(inArray(gitlabItems.branch, [...names]), inArray(gitlabItems.ref, [...names])))
      .all()
      .filter((i) => i.kind === "branch" || i.kind === "mr");
    const refs = items.map((i) => `gitlab:${i.key}`).filter((r) => !todo.refs.includes(r));
    if (!refs.length) continue;
    addTodoContext(id, refs, "", "Zeff");
    added += refs.length;
  }
  return added;
}

