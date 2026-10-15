import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * The board view, the logic under the drag & drop: what a card's grouped property becomes when it's
 * dropped into another column, and where it lands among the cards there.
 */

test("dropValue: a single value is replaced; a multi value only swaps the column it came from", async () => {
  const { dropValue, newProperty } = await import("@/plugins/workspace/model");
  const status = newProperty("Status", "status");
  const tags = { ...newProperty("Tags", "multi_select"), options: [{ id: "a", name: "A", color: "red" }, { id: "b", name: "B", color: "blue" }, { id: "c", name: "C", color: "green" }] };
  const who = newProperty("Who", "person");
  const done = newProperty("Done", "checkbox");

  assert.equal(dropValue(status, "x", "x", "y"), "y");
  assert.equal(dropValue(status, "x", "x", ""), null, "into No value: cleared");
  assert.deepEqual(dropValue(tags, ["a", "b"], "a", "c"), ["b", "c"], "the other tags stay");
  assert.deepEqual(dropValue(tags, ["a", "b"], "a", "b"), ["b"], "into a column it has already: no double");
  assert.equal(dropValue(tags, ["a"], "a", ""), null, "the last one out: none left");
  assert.deepEqual(dropValue(tags, ["a", "b"], "a", ""), ["b"]);
  assert.deepEqual(dropValue(tags, null, "", "c"), ["c"], "from No value");
  assert.deepEqual(dropValue(who, [3, 4], "3", "5"), [4, 5], "people: numbers");
  assert.equal(dropValue(done, false, "false", "true"), true);
});

test("placeRow: a card lands between its neighbours — the order holds after many moves", async () => {
  const w = await import("@/plugins/workspace/store");
  const dbId = w.createPage({ kind: "database", title: "Order" });
  const [a, b, c, d] = ["A", "B", "C", "D"].map((title) => w.addRow(dbId, { title }));
  const order = () => w.rawRows(dbId).map((r) => r.title).join("");
  assert.equal(order(), "ABCD");

  w.placeRow(d, { after: a, before: b });
  assert.equal(order(), "ADBC");
  w.placeRow(a, { after: c, before: null });
  assert.equal(order(), "DBCA", "to the end");
  w.placeRow(c, { after: null, before: d });
  assert.equal(order(), "CDBA", "to the top");
  // Always right behind C: the gap halves each time — the order must hold past what a float can split.
  const added: number[] = [];
  for (let i = 0; i < 60; i++) {
    const ids = w.rawRows(dbId).map((r) => r.id);
    const x = w.addRow(dbId, { title: `x${i}` });
    w.placeRow(x, { after: c, before: ids[ids.indexOf(c) + 1] ?? null });
    added.unshift(x);
  }
  const ids = w.rawRows(dbId).map((r) => r.id);
  assert.deepEqual(ids, [c, ...added, d, b, a], "each new one right behind C, the newest first");
  const other = w.createPage({ kind: "database", title: "Other" });
  assert.throws(() => w.placeRow(a, { after: w.addRow(other, { title: "O" }), before: null }), /not a row of the same database/);
});

/** A card's subtasks: the rows pointing at it through a relation to their own database (Parent) — done by their status. */
test("subtaskCounts: done/total per parent through a relation within the database", async () => {
  const { subtaskCounts, newProperty } = await import("@/plugins/workspace/model");
  const status = newProperty("Status", "status");
  const [todo, , done] = status.options!;
  const parent = { ...newProperty("Parent", "relation"), relationDb: 7 };
  const other = { ...newProperty("Elsewhere", "relation"), relationDb: 99 };
  const schema = { titleName: "Name", properties: [status, parent, other], views: [] };
  const row = (id: number, cells: Record<string, unknown>) => ({ id, title: `R${id}`, icon: "", cells, createdAt: "", updatedAt: "" });
  const rows = [row(1, {}), row(2, { [parent.id]: [1], [status.id]: done.id }), row(3, { [parent.id]: [1], [status.id]: todo.id }), row(4, { [other.id]: [1] }), row(5, { [parent.id]: [2] })];
  assert.deepEqual(subtaskCounts(schema, rows, 7), { 1: { done: 1, total: 2 }, 2: { done: 0, total: 1 } });
  assert.deepEqual(subtaskCounts(schema, rows, 8), {}, "a relation to another database isn't a parent");
});

/** What a ticket's card shows from Zeff: its todos (open first) and what the Lage says. */
test("ticketExtras: a card's todos and Lage by its key", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("todos", true);
  const { addManualTodo, setTodoStatus } = await import("@/lib/boards/store");
  const { ticketExtras } = await import("@/lib/items/tickets");
  const a = addManualTodo({ ticket: "WS-41", text: "Fliesen aussuchen" }) as { id: number };
  const b = addManualTodo({ ticket: "WS-41", text: "Termin machen" }) as { id: number };
  addManualTodo({ ticket: "WS-42", text: "Anderes" });
  setTodoStatus(b.id, "done");

  const x = ticketExtras(["WS-41", "WS-43"]);
  assert.deepEqual(Object.keys(x), ["WS-41"], "only keys with something to show");
  assert.deepEqual(x["WS-41"].todos.map((t) => [t.id, t.status]), [[a.id, "open"], [b.id, "done"]], "open first");
  assert.equal(x["WS-41"].attention, null, "no Lage run yet");
});

/** A row's properties panel leaves out what Zeff keeps for itself: the ticket key, a note's ref. */
test("panelProperties: the system properties (ticketkey, noteref) aren't shown", async () => {
  const { panelProperties, newProperty } = await import("@/plugins/workspace/model");
  const status = newProperty("Status", "status");
  const props = [status, { id: "ticketkey", name: "Key", type: "text" as const }, { id: "noteref", name: "Note", type: "text" as const }, { id: "color", name: "Color", type: "select" as const, options: [] }];
  assert.deepEqual(panelProperties(props).map((p) => p.name), ["Status", "Color"]);
});

/** A card's due date as Kanban showed it: red when past, amber today — not once the card is done. */
test("dueTone: overdue red, today amber, done or later nothing", async () => {
  const { dueTone } = await import("@/plugins/workspace/model");
  const today = "2026-10-16";
  assert.equal(dueTone("2026-10-15", today, false), "overdue");
  assert.equal(dueTone("2026-10-16", today, false), "today");
  assert.equal(dueTone({ start: "2026-10-16T09:00", end: "2026-10-17" }, today, false), "today", "a range: its start");
  assert.equal(dueTone("2026-10-17", today, false), null);
  assert.equal(dueTone("2026-10-01", today, true), null, "done: no alarm");
  assert.equal(dueTone(null, today, false), null);
});

/** A board's columns edited on the board (as Kanban's): moved, renamed, done or not, a WIP limit, removed when empty. */
test("column edits: move, rename, done, WIP limit, remove only when empty", async () => {
  const m = await import("@/plugins/workspace/model");
  const status = m.newProperty("Status", "status");
  const [a, b, c] = status.options!;
  const board = { ...m.newView("Board", "board"), groupBy: status.id };
  const schema: import("@/plugins/workspace/model").DbSchema = { titleName: "Name", properties: [status], views: [board] };
  const names = (s: typeof schema) => s.properties[0].options!.map((o) => o.name);

  assert.deepEqual(names(m.moveOption(schema, status.id, c.id, -1)), ["Not started", "Done", "In progress"]);
  assert.deepEqual(names(m.moveOption(schema, status.id, a.id, -1)), ["Not started", "In progress", "Done"], "at the edge: stays");
  assert.deepEqual(names(m.renameOption(schema, status.id, b.id, "  Dran ")), ["Not started", "Dran", "Done"]);
  assert.deepEqual(names(m.renameOption(schema, status.id, b.id, "   ")), ["Not started", "In progress", "Done"], "no empty name");
  assert.equal(m.setOptionDone(schema, status.id, b.id, true).properties[0].options![1].group, "done");
  assert.equal(m.setOptionDone(schema, status.id, c.id, false).properties[0].options![2].group, "doing");

  const limited = m.setWipLimit(schema, board.id, b.id, 3);
  assert.deepEqual(limited.views[0].wip, { [b.id]: 3 });
  assert.deepEqual(m.setWipLimit(limited, board.id, b.id, null).views[0].wip, {}, "no limit");

  const row = (cells: Record<string, unknown>) => ({ id: 1, title: "", icon: "", cells, createdAt: "", updatedAt: "" });
  assert.throws(() => m.removeOption(schema, status.id, b.id, [row({ [status.id]: b.id })]), /still has 1 card/);
  assert.deepEqual(names(m.removeOption(schema, status.id, b.id, [row({ [status.id]: a.id })])), ["Not started", "Done"]);
});

/** "Into / out of the briefing" (Kanban's sidebar button) and "into the knowledge", on a database — and the view knows the state. */
test("setCollectionAction: a database into the briefing and the knowledge, shown in its data", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("workspace", true);
  const w = await import("@/plugins/workspace/store");
  const a = await import("@/plugins/workspace/actions");
  const dbId = w.createPage({ kind: "database", title: "Schalter" });
  const state = async () => {
    const r = await a.loadDatabaseAction(dbId);
    assert.ok(r.ok);
    return [r.data.extras.briefing, r.data.extras.knowledge];
  };
  assert.deepEqual(await state(), [false, false]);
  assert.ok((await a.setCollectionAction(dbId, { briefing: true })).ok);
  assert.deepEqual(await state(), [true, false]);
  assert.ok((await a.setCollectionAction(dbId, { knowledge: true, briefing: false })).ok);
  assert.deepEqual(await state(), [false, true]);
});
