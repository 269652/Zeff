import { getSqlite } from "@/db";
import { addCalendarTodo, getTodo, setTodoDue, setTodoStatus, setTodoText, todoByRef } from "@/lib/todos/store";
import { docText, type Doc, type DocNode } from "./doc";
import { newId } from "./model";
import { breadcrumbs, getPage, updatePage } from "./store";

/**
 * The to-do lists that sit in pages as blocks. Each has an id of its own (and each item), a title, and a setting: whether its open items
 * are todos of the Todo engine too. A list is found by its page and id ("12:t3k9"), shown under its breadcrumb ("Workspace / Debt advice / ~1"
 * - the title when it has one), read and written from anywhere (a block that embeds it, a database that follows it), and turned into a
 * database. Server only.
 */

export type ListItem = { itemId: string; text: string; checked: boolean; depth: number; /** YYYY-MM-DD */ due: string | null };
export type TaskList = {
  /** "<page id>:<list id>" */
  key: string;
  pageId: number;
  listId: string;
  title: string;
  /** Its open items are todos of the Todo engine. */
  engine: boolean;
  /** Its place among the lists of its page (1-based): "~1". */
  ordinal: number;
  pageTitle: string;
  /** "Workspace / Debt advice / ~1" */
  path: string;
  items: ListItem[];
};

const ITEM_REF = /^bt:([\w-]+)$/;

// ---------------------------------------------------------------------------
// In a document
// ---------------------------------------------------------------------------

/** The lists of a document that are not inside another list's items (nested ones belong to their item), wherever they sit. */
function topLists(node: DocNode, out: DocNode[] = [], inItem = false): DocNode[] {
  if (node.type === "taskList" && !inItem) out.push(node);
  for (const c of node.content ?? []) topLists(c, out, inItem || node.type === "taskItem");
  return out;
}

const itemText = (item: DocNode): string =>
  (item.content ?? [])
    .filter((c) => c.type !== "taskList")
    .map((c) => docText(c))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

function itemsOf(list: DocNode, depth = 0): ListItem[] {
  return (list.content ?? []).flatMap((item) => [
    { itemId: String(item.attrs?.itemId ?? ""), text: itemText(item), checked: item.attrs?.checked === true, depth, due: /^\d{4}-\d{2}-\d{2}$/.test(String(item.attrs?.due ?? "")) ? String(item.attrs?.due) : null },
    ...(item.content ?? []).filter((c) => c.type === "taskList").flatMap((l) => itemsOf(l, depth + 1)),
  ]);
}

function listsOfPage(pageId: number): TaskList[] {
  const page = getPage(pageId);
  if (!page || page.archivedAt) return [];
  const crumbs = [...breadcrumbs(pageId).map((b) => b.title || "Untitled"), page.title || "Untitled"];
  return topLists(page.content as DocNode).map((l, i) => {
    const title = String(l.attrs?.title ?? "").trim();
    return {
      key: `${pageId}:${String(l.attrs?.listId ?? "")}`,
      pageId,
      listId: String(l.attrs?.listId ?? ""),
      title,
      engine: l.attrs?.engine === true,
      ordinal: i + 1,
      pageTitle: page.title || "Untitled",
      path: ["Workspace", ...crumbs, title || `~${i + 1}`].join(" / "),
      items: itemsOf(l),
    };
  });
}

/** Every to-do list in a page of the Workspace (not in the trash), by their path. */
export function allTaskLists(): TaskList[] {
  const rows = getSqlite().prepare("select id from ws_pages where archived_at is null and template = 0 and content like '%taskList%'").all() as { id: number }[];
  return rows.flatMap((r) => listsOfPage(r.id).filter((l) => l.listId)).sort((a, b) => a.path.localeCompare(b.path));
}

export function getTaskList(pageId: number, listId: string): TaskList | null {
  return listsOfPage(Number(pageId)).find((l) => l.listId === listId) ?? null;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/** A page's document changed by `fn` (on a copy; true: it did change) and saved. */
function editDoc(pageId: number, fn: (doc: Doc) => boolean): void {
  const page = getPage(pageId);
  if (!page) throw new Error("This page is gone.");
  const doc = structuredClone(page.content) as Doc;
  if (fn(doc)) updatePage(pageId, { content: doc });
}

const findList = (doc: Doc, listId: string): DocNode | undefined => topLists(doc as DocNode).find((l) => l.attrs?.listId === listId);
const findItem = (list: DocNode, itemId: string): DocNode | undefined => {
  for (const item of list.content ?? []) {
    if (item.attrs?.itemId === itemId) return item;
    for (const sub of (item.content ?? []).filter((c) => c.type === "taskList")) {
      const hit = findItem(sub, itemId);
      if (hit) return hit;
    }
  }
  return undefined;
};

const paragraph = (text: string): DocNode => ({ type: "paragraph", ...(text ? { content: [{ type: "text", text }] } : {}) });

export function setItemChecked(pageId: number, listId: string, itemId: string, checked: boolean): void {
  editDoc(pageId, (doc) => {
    const item = findItem(findList(doc, listId) ?? { type: "taskList" }, itemId);
    if (!item || (item.attrs?.checked === true) === checked) return false;
    item.attrs = { ...(item.attrs ?? {}), checked };
    return true;
  });
}

export function setItemText(pageId: number, listId: string, itemId: string, text: string): void {
  editDoc(pageId, (doc) => {
    const item = findItem(findList(doc, listId) ?? { type: "taskList" }, itemId);
    if (!item) return false;
    const rest = (item.content ?? []).filter((c) => c.type === "taskList");
    item.content = [paragraph(text.trim().slice(0, 500)), ...rest];
    return true;
  });
}

/** An item's due day (null: none). */
export function setItemDue(pageId: number, listId: string, itemId: string, due: string | null): void {
  editDoc(pageId, (doc) => {
    const item = findItem(findList(doc, listId) ?? { type: "taskList" }, itemId);
    if (!item || (item.attrs?.due ?? null) === due) return false;
    const attrs = { ...(item.attrs ?? {}) };
    if (due && /^\d{4}-\d{2}-\d{2}$/.test(due)) attrs.due = due;
    else delete attrs.due;
    item.attrs = attrs;
    return true;
  });
}

export function addItem(pageId: number, listId: string, text: string, due?: string | null): string {
  const id = newId("i");
  editDoc(pageId, (doc) => {
    const list = findList(doc, listId);
    if (!list) throw new Error("That list is gone.");
    list.content = [...(list.content ?? []), { type: "taskItem", attrs: { checked: false, itemId: id, ...(due && /^\d{4}-\d{2}-\d{2}$/.test(due) ? { due } : {}) }, content: [paragraph(text.trim().slice(0, 500))] }];
    return true;
  });
  return id;
}

export function removeItem(pageId: number, listId: string, itemId: string): void {
  editDoc(pageId, (doc) => {
    const list = findList(doc, listId);
    if (!list) return false;
    const drop = (l: DocNode): boolean => {
      const before = l.content?.length ?? 0;
      l.content = (l.content ?? []).filter((i) => i.attrs?.itemId !== itemId);
      let changed = (l.content?.length ?? 0) !== before;
      for (const item of l.content ?? []) for (const sub of (item.content ?? []).filter((c) => c.type === "taskList")) changed = drop(sub) || changed;
      return changed;
    };
    return drop(list);
  });
}

/** The list's title and whether its items feed the Todo engine. */
export function setListMeta(pageId: number, listId: string, v: { title?: string; engine?: boolean }): void {
  editDoc(pageId, (doc) => {
    const list = findList(doc, listId);
    if (!list) throw new Error("That list is gone.");
    const attrs = { ...(list.attrs ?? {}) };
    if (v.title !== undefined) attrs.title = v.title.trim().slice(0, 120);
    if (v.engine !== undefined) attrs.engine = v.engine;
    list.attrs = attrs;
    return true;
  });
  syncPageLists(pageId);
}

// ---------------------------------------------------------------------------
// Into a database
// ---------------------------------------------------------------------------

/**
 * The list turned into a database (a todo list with its Todo view, under the page): one row per item (a sub-item's title carries its parent
 * "Parent › Sub"), and the list's place in the page taken by that database's view. Its todos in the engine move to the rows.
 */
export async function convertToDatabase(pageId: number, listId: string): Promise<{ dbId: number; viewId: string }> {
  const list = getTaskList(pageId, listId);
  if (!list) throw new Error("That list is gone.");
  const { createTodoDatabase } = await import("./todo-lists");
  const parents: string[] = [];
  const items = list.items
    .filter((i) => i.text)
    .map((i) => {
      parents.length = i.depth;
      const title = [...parents, i.text].join(" › ");
      parents[i.depth] = i.text;
      return { itemId: i.itemId, title, done: i.checked, due: i.due ?? undefined };
    });
  const made = createTodoDatabase({ title: list.title || list.pageTitle, parentId: pageId, items: items.map((i) => ({ title: i.title, done: i.done, due: i.due })), engine: list.engine });
  // Its todos in the engine follow to the rows.
  const rows = getSqlite().prepare("select id from ws_pages where db_id = ? and template = 0 order by position, id").all(made.dbId) as { id: number }[];
  const rowOf = new Map(items.map((i, n) => [i.itemId, rows[n]?.id]));
  for (const [itemId, rowId] of rowOf) {
    const todo = todoByRef(`bt:${itemId}`);
    if (!todo || !rowId) continue;
    getSqlite().prepare("update todos set refs = ? where id = ?").run(JSON.stringify(todo.refs.map((r) => (r === `bt:${itemId}` ? `ws:${rowId}` : r))), todo.id);
  }
  editDoc(pageId, (doc) => {
    const swap = (n: DocNode): boolean => {
      const at = (n.content ?? []).findIndex((c) => c.type === "taskList" && c.attrs?.listId === listId);
      if (at >= 0) {
        n.content!.splice(at, 1, { type: "databaseView", attrs: { dbId: made.dbId, viewId: made.viewId, title: list.title || list.pageTitle } });
        return true;
      }
      return (n.content ?? []).some(swap);
    };
    return swap(doc as DocNode);
  });
  return made;
}

// ---------------------------------------------------------------------------
// The Todo engine
// ---------------------------------------------------------------------------

/** The lists of a page that feed the engine, their items with todos - and the todos of items that are gone dismissed. */
export function syncPageLists(pageId: number): void {
  const page = getPage(pageId);
  const lists = page && !page.archivedAt ? listsOfPage(pageId).filter((l) => l.engine) : [];
  const at = Date.parse(page?.updatedAt ?? "");
  const live = new Set<string>();
  for (const list of lists) {
    for (const item of list.items) {
      if (!item.itemId || !item.text) continue;
      live.add(item.itemId);
      const ref = `bt:${item.itemId}`;
      const todo = todoByRef(ref);
      const text = item.text.slice(0, 500);
      if (!todo) {
        if (!item.checked) addCalendarTodo({ text, due: item.due ?? "", ref, source: `Workspace „${list.path}“` });
      } else if (item.checked) {
        if (todo.status === "open") setTodoStatus(todo.id, "done", "Done in the Workspace.");
      } else if (todo.status !== "open") {
        if (Date.parse(todo.doneAt ?? "") > at) {
          if (todo.status === "done") setItemChecked(pageId, list.listId, item.itemId, true);
        } else setTodoStatus(todo.id, "open");
      } else {
        if (todo.text !== text) setTodoText(todo.id, text);
        if ((todo.due ?? null) !== item.due) setTodoDue(todo.id, item.due);
      }
    }
  }
  // Items of this page that left the engine (removed, the list switched off, the page in the trash).
  for (const t of openBlockTodos()) {
    if ((t.pageId === pageId || t.pageId === null) && !live.has(t.itemId)) setTodoStatus(t.todoId, "dismissed", "The item is no longer a to-do of the Workspace.");
  }
}

/** Open todos that come from list items: their todo, and the item's page when it is still found. */
function openBlockTodos(): { todoId: number; itemId: string; pageId: number | null; engine: boolean }[] {
  const rows = getSqlite().prepare("select id, refs from todos where status = 'open' and refs like '%\"bt:%'").all() as { id: number; refs: string }[];
  const where = new Map<string, { pageId: number; engine: boolean }>();
  for (const l of allTaskLists()) for (const i of l.items) if (i.itemId) where.set(i.itemId, { pageId: l.pageId, engine: l.engine });
  return rows.flatMap((r) => {
    const itemId = (JSON.parse(r.refs) as string[]).map((x) => ITEM_REF.exec(x)?.[1]).find(Boolean);
    return itemId ? [{ todoId: r.id, itemId, pageId: where.get(itemId)?.pageId ?? null, engine: where.get(itemId)?.engine ?? false }] : [];
  });
}

/** The scheduler's turn: every list that feeds the engine (also takes in a todo closed or opened again there), and every todo whose item is gone. */
export function syncTaskListsEngine(): number {
  const pages = new Set(allTaskLists().filter((l) => l.engine).map((l) => l.pageId));
  for (const id of pages) syncPageLists(id);
  for (const t of openBlockTodos()) if (t.pageId === null || !t.engine) setTodoStatus(t.todoId, "dismissed", "The item is no longer a to-do of the Workspace.");
  return pages.size;
}

/** A todo closed as done in the engine: the item it came from is ticked. */
export function blockTodoDone(todoId: number): void {
  const ref = getTodo(todoId)?.refs.map((r) => ITEM_REF.exec(r)?.[1]).find(Boolean);
  if (!ref) return;
  for (const l of allTaskLists()) if (l.items.some((i) => i.itemId === ref)) return void setItemChecked(l.pageId, l.listId, ref, true);
}

