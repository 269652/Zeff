import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

test("undo: an action that changed, made and removed pages is undone as a whole; it is kept once, and not twice undone", async () => {
  (await import("@/plugins/state")).setInstalled("workspace", true);
  const store = await import("@/plugins/workspace/store");
  const { undoable, undo, undoEntries, undoPreview } = await import("@/plugins/workspace/undo");
  const { applyOps } = await import("@/plugins/workspace/schema-ops");
  const db = store.createPage({ kind: "database", title: "Tasks" });
  const { schema } = applyOps(store.getDatabase(db)!.schema, [{ op: "add_property", name: "Note", type: "text" }], { related: () => null });
  const saved = store.saveSchema(db, schema);
  const note = saved.properties.find((p) => p.name === "Note")!;
  const a = store.addRow(db, { title: "A", cells: { [note.id]: "keep me" } });
  const b = store.addRow(db, { title: "B" });
  const outside = store.createPage({ title: "Untouched" });
  const cell = (id: number) => store.rowsOf(db)!.rows.find((r) => r.id === id)?.cells[note.id];

  let madeId = 0;
  const { value, undoId } = await undoable("Test action", async () => {
    store.setCell(a, note.id, "changed");
    store.setCell(a, note.id, "changed twice"); // (the state before the action counts, once)
    store.updatePage(b, { title: "B renamed" });
    store.archivePage(b);
    madeId = store.addRow(db, { title: "New" });
    return 42;
  });
  assert.equal(value, 42);
  assert.ok(undoId);
  assert.equal(cell(a), "changed twice");
  assert.equal(store.getPage(b)!.archivedAt !== null, true);
  const entry = undoEntries().find((e) => e.id === undoId)!;
  assert.deepEqual([entry.label, entry.pages, entry.undoable, entry.undone], ["Test action", 3, true, false]);
  assert.equal(undoPreview(undoId!).newerEdits >= 0, true);

  const r = await undo(undoId!);
  assert.deepEqual(r, { restored: 2, trashed: 1 });
  assert.equal(cell(a), "keep me");
  assert.equal(store.getPage(b)!.title, "B");
  assert.equal(store.getPage(b)!.archivedAt, null, "the removed row is back");
  assert.notEqual(store.getPage(madeId)!.archivedAt, null, "what it made is in the trash");
  assert.equal(store.getPage(outside)!.title, "Untouched");
  await assert.rejects(() => undo(undoId!), /undone already/);
  assert.equal(undoEntries().find((e) => e.id === undoId)!.undone, true);

  const none = await undoable("Nothing", () => store.getPage(a));
  assert.equal(none.undoId, null, "an action that changed nothing leaves no entry");
  const outer = await undoable("Outer", async () => (await undoable("Inner", () => store.setCell(a, note.id, "x"))).undoId);
  assert.equal(outer.value, null, "a nested action belongs to the outer one");
  assert.ok(outer.undoId);
});

test("undo: bulk actions and the AI's tool calls come with an entry; a routine run is one entry; the history lists them", async () => {
  (await import("@/plugins/state")).setInstalled("workspace", true);
  const store = await import("@/plugins/workspace/store");
  const { bulkSetAction, moveRowsAction, undoAction, undoEntriesAction } = await import("@/plugins/workspace/actions");
  const { asAgent } = await import("@/plugins/workspace/agent-scope");
  const { applyOps } = await import("@/plugins/workspace/schema-ops");
  const db = store.createPage({ kind: "database", title: "Bulk" });
  const { schema } = applyOps(store.getDatabase(db)!.schema, [{ op: "add_property", name: "Tag", type: "text" }], { related: () => null });
  const tag = store.saveSchema(db, schema).properties.find((p) => p.name === "Tag")!;
  const rows = [store.addRow(db, { title: "1" }), store.addRow(db, { title: "2" })];
  const tagOf = (id: number) => store.rowsOf(db)!.rows.find((r) => r.id === id)?.cells[tag.id];

  const set = await bulkSetAction(rows, tag.id, "x");
  assert.ok(set.ok && set.undoId);
  assert.deepEqual(rows.map(tagOf), ["x", "x"]);
  assert.ok((await undoAction(set.undoId!)).ok);
  assert.deepEqual(rows.map(tagOf), [undefined, undefined]);

  const other = store.createPage({ kind: "database", title: "Other" });
  const moved = await moveRowsAction([rows[0]], other);
  assert.ok(moved.ok && moved.undoId);
  assert.equal(store.rowsOf(db)!.rows.some((r) => r.id === rows[0]) && store.getPage(rows[0])!.archivedAt === null, false, "the row left");
  assert.ok((await undoAction(moved.undoId!)).ok);
  assert.equal(store.getPage(rows[0])!.archivedAt, null, "back in the first database");

  // The AI's tool call (as the MCP server runs it) is an entry of its own.
  await asAgent(async () => store.setCell(rows[1], tag.id, "by the AI"), "AI: test_tool")();
  const list = await undoEntriesAction();
  assert.ok(list.ok);
  const mine = list.entries.find((e) => e.label === "AI: test_tool")!;
  assert.deepEqual([mine.actor, mine.pages, mine.undoable], ["ai", 1, true]);
  assert.ok((await undoAction(mine.id)).ok);
  assert.equal(tagOf(rows[1]), undefined);
});
