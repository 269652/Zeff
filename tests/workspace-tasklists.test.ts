import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const item = (text: string, checked = false) => ({ type: "taskItem", attrs: { checked }, content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const list = (...items: ReturnType<typeof item>[]) => ({ type: "taskList", content: items });

async function world() {
  (await import("@/plugins/state")).setInstalled("workspace", true);
  const store = await import("@/plugins/workspace/store");
  const lists = await import("@/plugins/workspace/task-lists");
  const parent = store.createPage({ title: "Debt advice" });
  const page = store.createPage({ title: "Plan", parentId: parent, content: { type: "doc", content: [{ type: "paragraph" }, list(item("Call the office"), item("Send papers", true))] } });
  return { store, lists, parent, page };
}

test("block to-do lists: ids at once, a path with the breadcrumb, written from anywhere", async () => {
  const { lists, page } = await world();
  const all = lists.allTaskLists().filter((l) => l.pageId === page);
  assert.equal(all.length, 1);
  const l = all[0];
  assert.ok(l.listId && l.items.every((i) => i.itemId), "the list and its items got ids");
  assert.equal(l.path, "Workspace / Debt advice / Plan / ~1");
  assert.deepEqual(l.items.map((i) => [i.text, i.checked]), [["Call the office", false], ["Send papers", true]]);

  lists.setListMeta(page, l.listId, { title: "Office tasks" });
  assert.equal(lists.getTaskList(page, l.listId)!.path, "Workspace / Debt advice / Plan / Office tasks");
  lists.setItemChecked(page, l.listId, l.items[0].itemId, true);
  const added = lists.addItem(page, l.listId, "Phone the bank");
  lists.setItemText(page, l.listId, l.items[1].itemId, "Send the papers");
  lists.removeItem(page, l.listId, l.items[0].itemId);
  const now = lists.getTaskList(page, l.listId)!;
  assert.deepEqual(now.items.map((i) => [i.text, i.checked]), [["Send the papers", true], ["Phone the bank", false]]);
  assert.equal(now.items[1].itemId, added);
});

test("block to-do lists: a list that feeds the Todo engine - both ways, an item that is gone is dismissed", async () => {
  const { lists, page } = await world();
  const { todoByRef, getTodo } = await import("@/lib/boards/store");
  const { setTodoStatus } = await import("@/lib/boards/store");
  const l = lists.allTaskLists().find((x) => x.pageId === page)!;
  lists.setListMeta(page, l.listId, { engine: true });
  const call = l.items[0];
  const send = l.items[1];
  const t1 = todoByRef(`bt:${call.itemId}`);
  assert.ok(t1 && t1.status === "open" && t1.text === "Call the office", "an open item is a todo");
  assert.equal(todoByRef(`bt:${send.itemId}`), undefined, "a ticked item makes none");

  lists.setItemChecked(page, l.listId, call.itemId, true);
  lists.syncPageLists(page);
  assert.equal(getTodo(t1!.id)!.status, "done", "ticked in the page: done in the engine");

  const added = lists.addItem(page, l.listId, "Phone the bank");
  lists.syncPageLists(page);
  const t2 = todoByRef(`bt:${added}`)!;
  setTodoStatus(t2.id, "done");
  lists.blockTodoDone(t2.id);
  assert.equal(lists.getTaskList(page, l.listId)!.items.find((i) => i.itemId === added)!.checked, true, "done in the engine: ticked in the page");

  const another = lists.addItem(page, l.listId, "Another");
  lists.syncPageLists(page);
  const t3 = todoByRef(`bt:${another}`)!;
  lists.removeItem(page, l.listId, another);
  lists.syncPageLists(page);
  assert.equal(getTodo(t3.id)!.status, "dismissed", "the item is gone: its todo is dismissed");
  lists.setListMeta(page, l.listId, { engine: false });
  const t4 = lists.addItem(page, l.listId, "Quiet");
  lists.syncPageLists(page);
  assert.equal(todoByRef(`bt:${t4}`), undefined, "switched off: no todos");
});

test("block to-do lists as a data source: records with the list's path; ticking in a database ticks the item; one list by its key", async () => {
  const { lists, page, store } = await world();
  const { taskRecords, pullTasks } = await import("@/plugins/workspace/task-source");
  const other = store.createPage({ title: "Other", content: { type: "doc", content: [list(item("Elsewhere"))] } });
  const l = lists.allTaskLists().find((x) => x.pageId === page)!;
  const recs = taskRecords();
  assert.ok(recs.length >= 3);
  const mine = taskRecords(l.key);
  assert.deepEqual(mine.map((r) => r.title), ["Call the office", "Send papers"]);
  assert.equal(mine[0].typed![1].value, l.path);
  assert.ok(!mine.some((r) => r.title === "Elsewhere") && lists.getTaskList(other, lists.allTaskLists().find((x) => x.pageId === other)!.listId));
  // Ticking in a row (as the pipeline keeps it) ticks the item - unless the item changed since the row was read.
  const rec = mine[0];
  pullTasks(0, [{ id: 1, title: rec.title, icon: "", createdAt: "", updatedAt: "", cells: { srcref: rec.ref, srcedited: rec.updatedAt, taskdone: true } }]);
  assert.equal(lists.getTaskList(page, l.listId)!.items[0].checked, true);
  pullTasks(0, [{ id: 1, title: rec.title, icon: "", createdAt: "", updatedAt: "", cells: { srcref: rec.ref, srcedited: "stale", taskdone: false } }]);
  assert.equal(lists.getTaskList(page, l.listId)!.items[0].checked, true, "a stale row changes nothing");
});

test("block to-do lists: turned into a database - rows, the Todo view, the list's place taken by its view, todos follow", async () => {
  const { lists, page, store } = await world();
  const { todoByRef } = await import("@/lib/boards/store");
  const l = lists.allTaskLists().find((x) => x.pageId === page)!;
  lists.setListMeta(page, l.listId, { title: "Office tasks", engine: true });
  const open = l.items[0];
  const before = todoByRef(`bt:${open.itemId}`)!;
  const made = await lists.convertToDatabase(page, l.listId);
  const rows = store.rowsOf(made.dbId)!.rows;
  assert.deepEqual(rows.map((r) => [r.title, r.cells.todo_done === true]), [["Call the office", false], ["Send papers", true]]);
  const db = store.getDatabase(made.dbId)!;
  assert.equal(db.schema.views[0].type, "todo");
  assert.equal(db.schema.todoList?.engine, true, "the setting came along");
  assert.equal(db.page.parentId, page, "under the page");
  assert.equal(db.page.title, "Office tasks");
  const doc = JSON.stringify(store.getPage(page)!.content);
  assert.ok(!doc.includes('"taskList"') && doc.includes('"databaseView"') && doc.includes(`"dbId":${made.dbId}`));
  const after = todoByRef(`ws:${rows[0].id}`);
  assert.equal(after?.id, before.id, "the same todo, now carried by the row");
  assert.equal(todoByRef(`bt:${open.itemId}`), undefined);
});

test("todo lists as databases: feeding the Todo engine both ways, text and date follow, a removed row dismisses its todo", async () => {
  (await import("@/plugins/state")).setInstalled("workspace", true);
  const store = await import("@/plugins/workspace/store");
  const { createTodoDatabase } = await import("@/plugins/workspace/todo-lists");
  const engine = await import("@/plugins/workspace/todo-engine");
  const { todoByRef, getTodo, setTodoStatus } = await import("@/lib/boards/store");
  const { dbId } = createTodoDatabase({ title: "Chores", items: [{ title: "Wash up" }, { title: "Tax", done: true }] });
  const [a, b] = store.rowsOf(dbId)!.rows;
  assert.equal(todoByRef(`ws:${a.id}`), undefined, "off by default");
  engine.setTodoList(dbId, { engine: true });
  const ta = todoByRef(`ws:${a.id}`)!;
  assert.ok(ta && ta.status === "open" && ta.text === "Wash up");
  assert.equal(todoByRef(`ws:${b.id}`), undefined, "a done row makes none");

  store.setCell(a.id, "todo_due", "2026-11-02");
  store.updatePage(a.id, { title: "Wash up the pans" });
  engine.syncRow(a.id);
  assert.deepEqual([getTodo(ta.id)!.text, getTodo(ta.id)!.due], ["Wash up the pans", "2026-11-02"]);
  store.setCell(a.id, "todo_done", true);
  engine.syncRow(a.id);
  assert.equal(getTodo(ta.id)!.status, "done", "ticked row: done todo");
  store.setCell(b.id, "todo_done", false);
  engine.syncRow(b.id);
  const tb = todoByRef(`ws:${b.id}`)!;
  setTodoStatus(tb.id, "done");
  engine.todoDone(tb.id);
  assert.equal(store.rowsOf(dbId)!.rows.find((r) => r.id === b.id)!.cells.todo_done, true, "done in the engine: row ticked");
  const c = store.addRow(dbId, { title: "Bins" });
  engine.syncRow(c);
  const tc = todoByRef(`ws:${c}`)!;
  store.archivePage(c);
  engine.syncRow(c);
  assert.equal(getTodo(tc.id)!.status, "dismissed");
  engine.setTodoList(dbId, { engine: false });
  assert.equal(store.getDatabase(dbId)!.schema.todoList?.engine, undefined);
  engine.setTodoList(dbId, { engine: true });
  store.setCell(a.id, "todo_done", false);
  engine.syncRow(a.id);
  assert.equal(getTodo(ta.id)!.status, "open", "an open row whose todo was closed earlier: it is open again");
});

test("block to-do lists in Markdown: the head keeps id, title and engine; items keep their ids when the page is written anew; an embed has its line", async () => {
  const { lists, page, store } = await world();
  const { docToMarkdown, markdownToDoc } = await import("@/plugins/workspace/doc");
  const l = lists.allTaskLists().find((x) => x.pageId === page)!;
  lists.setListMeta(page, l.listId, { title: "Office tasks", engine: true });
  const md = docToMarkdown(store.getPage(page)!.content);
  assert.ok(md.includes(`:::list {"id":"${l.listId}","title":"Office tasks","engine":true}\n- [ ] Call the office\n- [x] Send papers`), md);
  // An AI writes the page again from that Markdown (no item ids in it): list and items are the same ones.
  const again = markdownToDoc(`${md}\n\n:::todolist 9 tx1\n`);
  assert.equal(again.content.some((n) => n.type === "todoListEmbed" && n.attrs?.pageId === 9 && n.attrs?.listId === "tx1"), true);
  store.updatePage(page, { content: again });
  const now = lists.getTaskList(page, l.listId)!;
  assert.deepEqual([now.title, now.engine], ["Office tasks", true]);
  assert.deepEqual(now.items.map((i) => i.itemId), l.items.map((i) => i.itemId), "the items keep their ids (same text)");
  assert.ok(docToMarkdown(store.getPage(page)!.content).includes(":::todolist 9 tx1"));
  // A list written without a head gets ids of its own.
  const fresh = store.createPage({ title: "Fresh", content: markdownToDoc("- [ ] one\n- [x] two") });
  const fl = lists.allTaskLists().find((x) => x.pageId === fresh)!;
  assert.ok(fl.listId && fl.items.every((i) => i.itemId) && new Set(fl.items.map((i) => i.itemId)).size === 2);
});

test("one model for lists and databases: a due day on an item, in Markdown, in the engine and across a conversion", async () => {
  const { lists, page, store } = await world();
  const { docToMarkdown, markdownToDoc } = await import("@/plugins/workspace/doc");
  const { todoByRef } = await import("@/lib/boards/store");
  const l = lists.allTaskLists().find((x) => x.pageId === page)!;
  lists.setItemDue(page, l.listId, l.items[0].itemId, "2026-11-02");
  assert.equal(lists.getTaskList(page, l.listId)!.items[0].due, "2026-11-02");
  const md = docToMarkdown(store.getPage(page)!.content);
  assert.ok(md.includes("- [ ] Call the office @due(2026-11-02)"), md);
  assert.equal(markdownToDoc(md).content.some((n) => n.type === "taskList" && n.content?.[0].attrs?.due === "2026-11-02"), true);
  lists.setListMeta(page, l.listId, { engine: true });
  assert.equal(todoByRef(`bt:${l.items[0].itemId}`)!.due, "2026-11-02", "the day is the todo's");
  lists.setItemDue(page, l.listId, l.items[0].itemId, "2026-12-24");
  lists.syncPageLists(page);
  assert.equal(todoByRef(`bt:${l.items[0].itemId}`)!.due, "2026-12-24");
  const { dbId } = await lists.convertToDatabase(page, l.listId);
  const row = store.rowsOf(dbId)!.rows[0];
  assert.equal(row.cells.todo_due, "2026-12-24", "the day became the row's");
});

test("a todo database turned back into a list: the rows are its items, the database's place is taken, the todos stay the same ones", async () => {
  const { lists, page, store } = await world();
  const { convertToList } = await import("@/plugins/workspace/todo-lists");
  const { todoByRef } = await import("@/lib/boards/store");
  const l = lists.allTaskLists().find((x) => x.pageId === page)!;
  lists.setItemDue(page, l.listId, l.items[0].itemId, "2026-11-02");
  lists.setListMeta(page, l.listId, { title: "Office tasks", engine: true });
  const before = todoByRef(`bt:${l.items[0].itemId}`)!;
  // list -> database -> list again: the same items, the same todo.
  const { dbId } = await lists.convertToDatabase(page, l.listId);
  const asRow = todoByRef(`ws:${store.rowsOf(dbId)!.rows[0].id}`)!;
  assert.equal(asRow.id, before.id);
  const back = convertToList(dbId);
  assert.equal(back.pageId, page, "in the page that showed the database");
  const now = lists.getTaskList(page, back.listId)!;
  assert.deepEqual(now.items.map((i) => [i.text, i.checked, i.due]), [["Call the office", false, "2026-11-02"], ["Send papers", true, null]]);
  assert.deepEqual([now.title, now.engine], ["Office tasks", true]);
  assert.equal(todoByRef(`bt:${now.items[0].itemId}`)!.id, before.id, "the todo follows to the item");
  assert.notEqual(store.getPage(dbId)!.archivedAt, null, "the database is in the trash");
  assert.ok(!JSON.stringify(store.getPage(page)!.content).includes('"databaseView"'));
  // A database that is nowhere shown: under its page the list is appended; with no page, a page of its own.
  const { createTodoDatabase } = await import("@/plugins/workspace/todo-lists");
  const under = createTodoDatabase({ title: "Chores", parentId: page, items: [{ title: "Wash up" }] });
  const r1 = convertToList(under.dbId);
  assert.equal(r1.pageId, page);
  assert.ok(lists.getTaskList(page, r1.listId)!.items.some((i) => i.text === "Wash up"));
  const loose = createTodoDatabase({ title: "Loose", items: [{ title: "One" }, { title: "Two", done: true }] });
  const r2 = convertToList(loose.dbId);
  assert.notEqual(r2.pageId, page);
  assert.equal(store.getPage(r2.pageId)!.title, "Loose");
  assert.deepEqual(lists.getTaskList(r2.pageId, r2.listId)!.items.map((i) => [i.text, i.checked]), [["One", false], ["Two", true]]);
  assert.throws(() => convertToList(store.createPage({ kind: "database", title: "No box" })), /checkbox/);
});

test("the setting 'Hide titles automatically': on unless switched off, and it stays", async () => {
  const { autoHideTitlesAction } = await import("@/plugins/workspace/actions");
  const first = await autoHideTitlesAction();
  assert.ok(first.ok && first.value === true);
  const off = await autoHideTitlesAction(false);
  assert.ok(off.ok && off.value === false);
  const again = await autoHideTitlesAction();
  assert.ok(again.ok && again.value === false);
  await autoHideTitlesAction(true);
});
