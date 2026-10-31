/**
 * A todo's action that its own button ran (your click — a mail sent or drafted through Gmail's API, an event entered in Google
 * Calendar), not the todo's "Run": checked to be still on the todo, then taken off it, noted there, counted for the auto-actions'
 * learning when they proposed it — and a mail that answers or asks is the todo itself: done with it. Server only.
 */
import { eq } from "drizzle-orm";
import { getDb, getSqlite, schema } from "@/db";
import type { TodoOp, TodoView } from "@/lib/todos/shared";
import { emitChange } from "@/lib/events";
import { t } from "@/lib/i18n/server";
import { actionOf } from "./catalog";

const same = (a: unknown, b: unknown) => JSON.stringify(a, (_k, v) => (typeof v === "string" ? v.trim() : v)) === JSON.stringify(b, (_k, v) => (typeof v === "string" ? v.trim() : v));

/** The todo and its action at `index`, of this type — else an error (it was run already, or changed meanwhile). */
export async function clickedOp<T extends TodoOp["type"]>(todoId: number, index: number, type: T): Promise<{ todo: TodoView; op: Extract<TodoOp, { type: T }> }> {
  const { getTodo } = await import("@/lib/todos/store");
  const todo = getTodo(Number(todoId));
  const op = todo?.ops[Number(index)];
  if (!todo || !op || op.type !== type) throw new Error(t("That action isn't on the todo (any more)."));
  if (todo.status !== "open") throw new Error(todo.status === "done" ? t("{ref} is done already.", { ref: todo.ref }) : t("{ref} is dismissed already.", { ref: todo.ref }));
  return { todo, op: op as Extract<TodoOp, { type: T }> };
}

/**
 * What your clicks ran, one line each (the todo, the action, what it did) — what the timeline reads as your actions. Kept in a table
 * of its own (made on first use), the last 2000.
 */
function logClick(todo: TodoView, op: TodoOp, what: string): void {
  try {
    const d = getSqlite();
    d.exec("create table if not exists action_clicks (id integer primary key autoincrement, at text not null, todo_id integer not null, type text not null, what text not null default '', op text not null default '{}')");
    d.prepare("insert into action_clicks (at, todo_id, type, what, op) values (?, ?, ?, ?, ?)").run(new Date().toISOString(), todo.id, op.type, what.slice(0, 500), JSON.stringify(op).slice(0, 4000));
    d.prepare("delete from action_clicks where id <= (select max(id) - 2000 from action_clicks)").run();
  } catch {
    // the log never stops an action
  }
}

/** What ran, off the todo and noted on it; done with it when it was the todo (a reply, a question …). Whether it was. */
export async function settleClickedOp(todo: TodoView, op: TodoOp, what: string): Promise<boolean> {
  logClick(todo, op, what);
  const store = await import("@/lib/todos/store");
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
    const { attributed } = await import("@/lib/todos/activity");
    attributed("you", () => store.setTodoStatus(todo.id, "done", `Done: ${what}`.slice(0, 500)));
  }
  emitChange("todos");
  return settles;
}
