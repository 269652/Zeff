import { inArray, or } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { TodoOp, TodoView } from "@/lib/boards/shared";
import { addTodoContext, getTodo } from "@/lib/boards/store";

const { gitlabItems } = schema;

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

/**
 * A todo's feature branch and merge request as context — linked: the GitLab items Zeff has synced
 * for the branches its work and delivery name (the branch itself, its merge request) join the
 * todo's context, each once. Nothing for a branch that isn't on GitLab (yet): the GitLab sync calls
 * this again. How many were added.
 */
export function linkBranchContext(todoIds: number[]): number {
  let added = 0;
  for (const id of new Set(todoIds)) {
    const todo = getTodo(id);
    if (!todo || todo.status !== "open") continue;
    const names = branchNamesOf(todo);
    if (!names.length) continue;
    const items = getDb()
      .select({ key: gitlabItems.key, kind: gitlabItems.kind })
      .from(gitlabItems)
      .where(or(inArray(gitlabItems.branch, names), inArray(gitlabItems.ref, names)))
      .all()
      .filter((i) => i.kind === "branch" || i.kind === "mr");
    const refs = items.map((i) => `gitlab:${i.key}`).filter((r) => !todo.refs.includes(r));
    if (!refs.length) continue;
    addTodoContext(id, refs, "", "Zeff");
    added += refs.length;
  }
  return added;
}
