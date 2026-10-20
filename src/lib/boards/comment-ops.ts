import { listTodos, setTodoOps } from "./store";
import type { TodoOp } from "./shared";
import { gitlabItemsByKeys } from "@/lib/gitlab/store";
import { isInstalled } from "@/plugins/state";

/**
 * A todo that stands for GitLab review comments (its refs name them: "gitlab:note:<id>") offers "Resolve" for every thread still open — and,
 * before it, the reply the AI drafted. Added to what the todo has (a hand-over to a worker, a merge request stay as they are), never twice.
 */

/** The notes (as keys: "note:<id>") a todo's refs name, once each. */
export const noteKeysOf = (refs: string[]): string[] => [...new Set(refs.flatMap((r) => (/^gitlab:(note:\d+)$/.exec(r) ? [r.slice("gitlab:".length)] : [])))];

type Item = { kind: string; state: string | null; resolvedAt: string | null };
/** Of these notes, the comments whose thread is not resolved (a note that isn't among the synced ones is not offered). */
export const openThreads = (keys: string[], items: Map<string, Item>): string[] =>
  keys.filter((k) => {
    const it = items.get(k);
    return !!it && it.kind === "comment" && it.state !== "resolved" && !it.resolvedAt;
  });

/**
 * The ops with a Resolve for each of the open threads (those without one yet), and the proposed replies in front of their thread's
 * Resolve — one per note, only for open threads.
 */
export function withCommentOps(ops: TodoOp[], open: string[], replies: TodoOp[]): TodoOp[] {
  const out = [...ops];
  const has = (type: string, note: string) => out.some((o) => o.type === type && "note" in o && o.note === note);
  for (const note of open) if (!has("gitlab-resolve", note)) out.push({ type: "gitlab-resolve", note });
  for (const r of replies) {
    if (r.type !== "gitlab-reply" || !open.includes(r.note) || has("gitlab-reply", r.note)) continue;
    const at = out.findIndex((o) => o.type === "gitlab-resolve" && o.note === r.note);
    out.splice(at < 0 ? out.length : at, 0, r);
  }
  return out;
}

/**
 * Replies that answer every open thread of the todo make its hand-overs to a worker obsolete: what they would have the worker do is done
 * (the replies say so, from the context that is there). With a thread left unanswered the hand-over stays.
 */
export function dropObsoleteInstructs(ops: TodoOp[], open: string[]): TodoOp[] {
  if (!open.length || !open.every((n) => ops.some((o) => o.type === "gitlab-reply" && o.note === n))) return ops;
  return ops.filter((o) => o.type !== "work-instruct");
}

/** The open todos that name comments, with the open threads among them: `{ todo, keys, open }`. */
export function commentTodos(): { id: number; ops: TodoOp[]; keys: string[]; open: string[] }[] {
  if (!isInstalled("gitlab")) return [];
  const todos = listTodos({ status: "open" }).map((t) => ({ t, keys: noteKeysOf(t.refs) })).filter((x) => x.keys.length);
  if (!todos.length) return [];
  const items = gitlabItemsByKeys([...new Set(todos.flatMap((x) => x.keys))]);
  return todos.map(({ t, keys }) => ({ id: t.id, ops: t.ops, keys, open: openThreads(keys, items) })).filter((x) => x.open.length);
}

/** Every open todo gets the Resolve actions of its open threads. Returns how many todos changed. */
export async function attachCommentOps(): Promise<number> {
  let n = 0;
  for (const c of commentTodos()) {
    const next = withCommentOps(c.ops, c.open, []);
    if (next.length !== c.ops.length) {
      setTodoOps(c.id, next);
      n++;
    }
  }
  return n;
}
