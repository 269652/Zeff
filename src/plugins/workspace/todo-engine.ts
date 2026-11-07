import { getSqlite } from "@/db";
import { addCalendarTodo, getTodo, setTodoDue, setTodoStatus, setTodoText, todoByRef } from "@/lib/todos/store";
import { dateRange, todoColumns, type DbSchema, type Property } from "./model";

export { todoColumns };
import { getDatabase, getPage, saveSchema, setCell } from "./store";

/**
 * Todo lists of the Workspace and the Todo engine (the Todos tab): a database that is a todo list (`schema.todoList`: which checkbox says
 * done, which date says due) can feed the engine - each open row is a todo there ("ws:<row id>"), which then shows up where the others do
 * (Todos, the weekly report's "done today", agents' context). Both ways: ticking a row closes its todo, closing the todo ticks the row;
 * the row's text and date are the todo's while it is open; a row sent to the trash dismisses it. Whichever side was changed last wins when
 * they disagree. Server only.
 */

const REF = /^ws:(\d+)$/;
const refOf = (rowId: number) => `ws:${rowId}`;

const dueOf = (cells: Record<string, unknown>, due: Property | undefined): string | null => (due ? (dateRange(cells[due.id])?.start.slice(0, 10) ?? null) : null);

/** One row and its todo brought together (nothing when the database does not feed the engine). */
export function syncRow(rowId: number, opts: { reopenDismissed?: boolean } = {}): void {
  const row = getPage(rowId);
  const d = row?.dbId ? getDatabase(row.dbId) : null;
  if (!row || !d?.schema.todoList?.engine) return;
  const cols = todoColumns(d.schema);
  if (!cols) return;
  const ref = refOf(rowId);
  const todo = todoByRef(ref);
  const isDone = row.props[cols.done.id] === true;
  const title = row.title.trim().slice(0, 500) || "(untitled)";
  const due = dueOf(row.props, cols.due);

  // (Only dated rows are todos — the Agenda's notes with a reminder: one without leaves the Todos, or never enters them.)
  if (row.archivedAt || row.template || (d.schema.todoList.dated && !due)) {
    if (todo?.status === "open") setTodoStatus(todo.id, "dismissed", "The entry was removed from the Workspace.");
    return;
  }
  if (!todo) {
    if (!isDone) addCalendarTodo({ text: title, due: due ?? "", ref, source: `Workspace „${d.page.title || "Todos"}“` });
    return;
  }
  if (isDone) {
    if (todo.status === "open") setTodoStatus(todo.id, "done", "Done in the Workspace.");
    return;
  }
  if (todo.status !== "open") {
    // The row is open, the todo is closed: whichever was touched last decides.
    if (!opts.reopenDismissed && Date.parse(todo.doneAt ?? "") > Date.parse(row.updatedAt)) {
      if (todo.status === "done") setCell(rowId, cols.done.id, true);
    } else setTodoStatus(todo.id, "open");
    return;
  }
  if (todo.text !== title) setTodoText(todo.id, title);
  if ((todo.due ?? null) !== due) setTodoDue(todo.id, due);
}

/** Every row of a database brought together with its todo. How many rows there are. */
export function syncDatabase(dbId: number, opts: { reopenDismissed?: boolean } = {}): number {
  const ids = getSqlite().prepare("select id from ws_pages where db_id = ? and template = 0").all(dbId) as { id: number }[];
  for (const { id } of ids) syncRow(id, opts);
  return ids.length;
}

/** The scheduler's turn: every todo list that feeds the engine (also catches a todo opened again or dismissed there). */
export function syncTodoEngine(): number {
  let n = 0;
  for (const { id } of getSqlite().prepare("select id from ws_pages where kind = 'database' and archived_at is null").all() as { id: number }[]) {
    if (getDatabase(id)?.schema.todoList?.engine) n += syncDatabase(id);
  }
  return n;
}

/** A todo closed as done in the engine: the row it came from is ticked. */
export function todoDone(todoId: number): void {
  const ref = getTodo(todoId)?.refs.find((r) => REF.test(r));
  const rowId = ref ? Number(REF.exec(ref)![1]) : 0;
  if (rowId) syncRow(rowId);
}

/** The setting: whether the database feeds the engine, and which fields it goes by. On: its open rows become todos; off: the todos it made are dismissed. */
export function setTodoList(dbId: number, v: { done?: string; due?: string; engine?: boolean }): DbSchema {
  const d = getDatabase(dbId);
  if (!d) throw new Error("No such database.");
  const was = !!d.schema.todoList?.engine;
  const cols = todoColumns({ ...d.schema, todoList: { done: v.done ?? d.schema.todoList?.done ?? "", due: v.due ?? d.schema.todoList?.due, engine: false } });
  if (!cols) throw new Error("A todo list needs a checkbox field that says done.");
  const saved = saveSchema(dbId, { ...d.schema, todoList: { done: cols.done.id, ...(v.due !== undefined ? (v.due ? { due: v.due } : {}) : cols.due ? { due: cols.due.id } : {}), engine: !!v.engine } });
  if (v.engine && !was) syncDatabase(dbId, { reopenDismissed: true });
  if (!v.engine && was) {
    for (const { id } of getSqlite().prepare("select id from ws_pages where db_id = ?").all(dbId) as { id: number }[]) {
      const todo = todoByRef(refOf(id));
      if (todo?.status === "open") setTodoStatus(todo.id, "dismissed", "The Workspace's todo list no longer feeds the Todo engine.");
    }
  }
  return saved;
}
