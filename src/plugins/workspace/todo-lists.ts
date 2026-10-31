import { getSqlite } from "@/db";
import { todoByRef } from "@/lib/todos/store";
import type { Doc, DocNode } from "./doc";
import { dateRange, newId, newView, todoColumns, type DbSchema } from "./model";
import { addRow, archivePage, createPage, getDatabase, getPage, rawRows, updatePage } from "./store";
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

/**
 * A todo database turned into a list in a page (the way back of "Turn into a database"): its rows become the items of one list block - in
 * the page that shows the database (its place is taken), else at the end of the page it lies under, else in a page of its own. The database
 * goes to the trash; its todos in the Todo engine stay the same todos, now carried by the items.
 */
export function convertToList(dbId: number): { pageId: number; listId: string } {
  const d = getDatabase(dbId);
  if (!d) throw new Error("No such database.");
  const cols = todoColumns(d.schema);
  if (!cols) throw new Error("This database has no checkbox that says done.");
  const rows = rawRows(dbId);
  const made = rows.map((r) => ({ rowId: r.id, itemId: newId("i"), title: r.title.trim() || "(untitled)", done: r.cells[cols.done.id] === true, due: cols.due ? (dateRange(r.cells[cols.due.id])?.start.slice(0, 10) ?? null) : null }));
  const listId = newId("t");
  const node: DocNode = {
    type: "taskList",
    attrs: { listId, ...(d.page.title.trim() ? { title: d.page.title.trim() } : {}), ...(cols.engine ? { engine: true } : {}) },
    content: made.map((i) => ({ type: "taskItem", attrs: { checked: i.done, itemId: i.itemId, ...(i.due ? { due: i.due } : {}) }, content: [{ type: "paragraph", content: [{ type: "text", text: i.title }] }] })),
  };
  // Where it goes: where the database is shown, else under its page, else a page of its own.
  const sqlite = getSqlite();
  let pageId = 0;
  let doc: Doc | null = null;
  const showing = sqlite.prepare("select id from ws_pages where archived_at is null and content like '%databaseView%' and content like ?").all(`%"dbId":${dbId}%`) as { id: number }[];
  for (const { id } of showing) {
    const page = getPage(id);
    if (!page) continue;
    const copy = structuredClone(page.content) as Doc;
    const swap = (n: DocNode): boolean => {
      const at = (n.content ?? []).findIndex((c) => c.type === "databaseView" && Number(c.attrs?.dbId) === dbId);
      if (at >= 0) return (n.content!.splice(at, 1, node), true);
      return (n.content ?? []).some(swap);
    };
    if (swap(copy as DocNode)) {
      pageId = id;
      doc = copy;
      break;
    }
  }
  if (!pageId && d.page.parentId && getPage(d.page.parentId)) {
    pageId = d.page.parentId;
    doc = structuredClone(getPage(pageId)!.content) as Doc;
    doc.content = [...doc.content, node];
  }
  // Its todos follow to the items - before the page is saved, so the engine finds them there.
  for (const i of made) {
    const todo = todoByRef(`ws:${i.rowId}`);
    if (todo) sqlite.prepare("update todos set refs = ? where id = ?").run(JSON.stringify(todo.refs.map((r) => (r === `ws:${i.rowId}` ? `bt:${i.itemId}` : r))), todo.id);
  }
  if (pageId && doc) updatePage(pageId, { content: doc });
  else pageId = createPage({ title: d.page.title || "Todos", icon: "✅", content: { type: "doc", content: [node] } });
  archivePage(dbId);
  return { pageId, listId };
}
