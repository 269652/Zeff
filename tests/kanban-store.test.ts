import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const titles = (cards: { title: string }[]) => cards.map((c) => c.title);

/** An archived card isn't lost: it's listed, and comes back at the end of its column. */
test("archive: a card can be listed and restored, and its subtasks stay behind as cards of their own", async () => {
  const s = await import("@/plugins/kanban/store");
  const b = s.createBoard({ name: "Archive" });
  const [open] = s.getBoard(b).columns;
  const parent = s.createCard(open.id, "Parent");
  const kid = s.createSubtask(parent.id, "Kid");
  s.createCard(open.id, "Other");

  s.archiveCard(parent.id);
  const view = s.getBoard(b).columns[0].cards;
  assert.deepEqual(titles(view).sort(), ["Kid", "Other"]);
  assert.equal(view.find((c) => c.id === kid.id)!.parentId, null, "the subtask is a card of its own now");
  assert.deepEqual(titles(s.listArchivedCards(b)), ["Parent"]);
  assert.equal(s.listArchivedCards(b)[0].column, open.name);

  s.restoreCard(parent.id);
  assert.deepEqual(titles(s.getBoard(b).columns[0].cards), ["Kid", "Other", "Parent"], "back at the end of its column");
  assert.equal(s.listArchivedCards(b).length, 0);
  assert.throws(() => s.restoreCard(999999), /doesn't exist/);
});

/** Deleting a column must not take its archived cards with it. */
test("deleteColumn: archived cards move to another column instead of being deleted", async () => {
  const s = await import("@/plugins/kanban/store");
  const b = s.createBoard({ name: "Columns" });
  const [open, doing] = s.getBoard(b).columns;
  const live = s.createCard(doing.id, "Live");
  const old = s.createCard(doing.id, "Old");
  s.archiveCard(old.id);

  assert.throws(() => s.deleteColumn(doing.id), /still has 1 card/);
  s.moveCard(live.id, open.id, null);
  s.deleteColumn(doing.id);
  const archived = s.listArchivedCards(b);
  assert.deepEqual(titles(archived), ["Old"], "still there");
  assert.equal(archived[0].columnId, open.id);
  s.restoreCard(old.id);
  assert.deepEqual(titles(s.getBoard(b).columns[0].cards).sort(), ["Live", "Old"]);

  // The last column of a board with archived cards can't go.
  const only = s.createBoard({ name: "One", columns: ["A"] });
  const col = s.getBoard(only).columns[0];
  s.archiveCard(s.createCard(col.id, "x").id);
  assert.throws(() => s.deleteColumn(col.id), /archived cards/);
});

/** Flagging a column "done" later counts the cards already in it as done (the briefing keys on doneAt). */
test("done column: the flag sets and clears doneAt on the cards in it", async () => {
  const s = await import("@/plugins/kanban/store");
  const { kanbanLageTickets } = await import("@/plugins/kanban/lage");
  const b = s.createBoard({ name: "Done flag", columns: ["Todo", "Review", "Shipped"] });
  const [, review] = s.getBoard(b).columns;
  const card = s.createCard(review.id, "In review");
  assert.equal(card.doneAt, null);
  const doneAt = () => s.getBoard(b).columns[1].cards[0].doneAt;

  s.updateColumn(review.id, { done: true });
  assert.ok(doneAt(), "counted as done since now");
  const first = doneAt();
  s.updateColumn(review.id, { name: "Review ✓" });
  assert.equal(doneAt(), first, "other edits leave it alone");
  assert.ok(kanbanLageTickets().some((t) => t.issue.key === card.ref && t.done), "a card done a moment ago is in the briefing");

  s.updateColumn(review.id, { done: false });
  assert.equal(doneAt(), null, "open again");
});

/** Cards keep their order, also after many inserts at the same spot (the midpoints run out). */
test("moveCard: order holds after many inserts in front of the same card", async () => {
  const s = await import("@/plugins/kanban/store");
  const b = s.createBoard({ name: "Order", columns: ["A", "B"] });
  const [a, bcol] = s.getBoard(b).columns;
  const first = s.createCard(a.id, "first");
  const last = s.createCard(a.id, "last");
  const moved: string[] = [];
  for (let i = 0; i < 70; i++) {
    const c = s.createCard(bcol.id, `m${i}`);
    s.moveCard(c.id, a.id, last.id);
    moved.push(c.title);
  }
  const order = titles(s.getBoard(b).columns[0].cards);
  assert.deepEqual(order, ["first", ...moved, "last"], "each one landed right before 'last'");
  assert.ok(first.id);
});

/** A subtask is made in one step: a bad parent leaves no stray card behind. */
test("createSubtask: nothing is left behind when the parent is wrong", async () => {
  const s = await import("@/plugins/kanban/store");
  const b = s.createBoard({ name: "Atomic" });
  const [open] = s.getBoard(b).columns;
  const parent = s.createCard(open.id, "P");
  const kid = s.createSubtask(parent.id, "K");
  const before = s.getBoard(b).columns[0].cards.length;
  assert.throws(() => s.createSubtask(kid.id, "Grandkid"), /can't have subtasks/);
  assert.throws(() => s.createSubtask(999999, "Ghost"), /doesn't exist/);
  assert.equal(s.getBoard(b).columns[0].cards.length, before);
});
