import { newView, type DbSchema } from "./model";
import { addRow, createPage, getDatabase, updatePage } from "./store";
import { setTodoList } from "./todo-engine";

/** The fixed ids of a todo list's two fields (the Todo view and the Todo engine go by them). */
export const TODO_FIELDS = { done: "todo_done", due: "todo_due" } as const;

/** The schema of a todo list: a title, a box "Done" and a date "Due", the Todo view first and a table beside it. */
export function todoListSchema(titleName = "Task"): DbSchema {
  const todo = newView("Todos", "todo");
  return {
    titleName,
    properties: [
      { id: TODO_FIELDS.done, name: "Done", type: "checkbox" },
      { id: TODO_FIELDS.due, name: "Due", type: "date" },
    ],
    views: [todo, newView("Table", "table")],
    todoList: { done: TODO_FIELDS.done, due: TODO_FIELDS.due },
  };
}

/** A database that is a todo list (under a page, or at the top), its rows made from `items`; it feeds the Todo engine when `engine`. */
export function createTodoDatabase(v: { title: string; parentId?: number | null; items?: { title: string; done?: boolean; due?: string }[]; engine?: boolean }): { dbId: number; viewId: string } {
  const schema = todoListSchema();
  const dbId = createPage({ kind: "database", title: v.title.trim().slice(0, 300) || "Todos", icon: "✅", parentId: v.parentId ?? null, schema });
  updatePage(dbId, { fullWidth: false });
  for (const item of v.items ?? []) {
    addRow(dbId, { title: item.title, cells: { [TODO_FIELDS.done]: item.done === true, ...(item.due ? { [TODO_FIELDS.due]: item.due } : {}) } });
  }
  if (v.engine) setTodoList(dbId, { engine: true });
  return { dbId, viewId: getDatabase(dbId)!.schema.views[0].id };
}
