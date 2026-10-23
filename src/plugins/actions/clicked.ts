/**
 * A todo's action that its own button ran (your click — a mail sent or drafted through Gmail's API, an event entered in Google
 * Calendar), not the todo's "Run": checked to be still on the todo, then taken off it, noted there, counted for the auto-actions'
 * learning when they proposed it — and a mail that answers or asks is the todo itself: done with it. Server only.
 */
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { TodoOp, TodoView } from "@/lib/boards/shared";
import { emitChange } from "@/lib/events";
import { t } from "@/lib/i18n/server";
import { actionOf } from "./catalog";

const same = (a: unknown, b: unknown) => JSON.stringify(a, (_k, v) => (typeof v === "string" ? v.trim() : v)) === JSON.stringify(b, (_k, v) => (typeof v === "string" ? v.trim() : v));

/** The todo and its action at `index`, of this type — else an error (it was run already, or changed meanwhile). */
export async function clickedOp<T extends TodoOp["type"]>(todoId: number, index: number, type: T): Promise<{ todo: TodoView; op: Extract<TodoOp, { type: T }> }> {
  const { getTodo } = await import("@/lib/boards/store");
  const todo = getTodo(Number(todoId));
  const op = todo?.ops[Number(index)];
  if (!todo || !op || op.type !== type) throw new Error(t("That action isn't on the todo (any more)."));
  if (todo.status !== "open") throw new Error(todo.status === "done" ? t("{ref} is done already.", { ref: todo.ref }) : t("{ref} is dismissed already.", { ref: todo.ref }));
  return { todo, op: op as Extract<TodoOp, { type: T }> };
}

/** What ran, off the todo and noted on it; done with it when it was the todo (a reply, a question …). Whether it was. */
export async function settleClickedOp(todo: TodoView, op: TodoOp, what: string): Promise<boolean> {
  const store = await import("@/lib/boards/store");
  const now = store.getTodo(todo.id);
  const ops = now?.ops ?? [];
  const at = ops.findIndex((o) => same(o, op));
  const left = at >= 0 ? ops.filter((_, i) => i !== at) : ops;
  getDb().update(schema.todos).set({ ops: JSON.stringify(left) }).where(eq(schema.todos.id, todo.id)).run();
  store.addTodoUserNote(todo.id, `✓ ${what}`);
  if (todo.autoOpsWhy) {
    const { recordFeedback } = await import("@/lib/learning/ledger");
    const { autoActionsFeedback } = await import("@/lib/learning/sources");
    recordFeedback(autoActionsFeedback(todo, "accepted", op));
  }
  const settles = !!actionOf(op.type).comms && !left.length && todo.owner === "me" && ["reply", "comment", "clarify", "update"].includes(todo.kind);
  if (settles) {
    const { attributed } = await import("@/lib/boards/activity");
    attributed("you", () => store.setTodoStatus(todo.id, "done", `Done: ${what}`.slice(0, 500)));
  }
  emitChange("todos");
  return settles;
}
