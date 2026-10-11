import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** A subtask is a card of its own on the board, in any column, linked to its parent. */
test("subtasks: linked to the parent, a column of their own, cut loose on delete or move", async () => {
  const s = await import("@/plugins/kanban/store");
  const a = s.createBoard({ name: "A" });
  const b = s.createBoard({ name: "B" });
  const boardA = s.getBoard(a);
  const [open, doing] = boardA.columns;
  const parent = s.createCard(open.id, "Parent");
  const kid = s.createSubtask(parent.id, "Kid");
  assert.equal(kid.parentId, parent.id);
  assert.equal(kid.columnId, open.id, "starts in the parent's column");
  s.moveCard(kid.id, doing.id, null);
  const view = s.getBoard(a);
  const cards = view.columns.flatMap((c) => c.cards);
  assert.equal(cards.find((c) => c.id === kid.id)!.columnId, doing.id);
  assert.equal(cards.find((c) => c.id === kid.id)!.parentId, parent.id, "the link stays when it moves");
  assert.throws(() => s.createSubtask(kid.id, "Grandkid"), /keine eigenen Unteraufgaben/);

  s.detachSubtask(kid.id);
  assert.equal(s.getBoard(a).columns.flatMap((c) => c.cards).find((c) => c.id === kid.id)!.parentId, null);

  const kid2 = s.createSubtask(parent.id, "Kid 2");
  s.moveCardToBoard(parent.id, b);
  assert.equal(s.getBoard(a).columns.flatMap((c) => c.cards).find((c) => c.id === kid2.id)!.parentId, null, "a parent that moves leaves its subtasks as cards of their own");

  const p2 = s.createCard(open.id, "P2");
  const k3 = s.createSubtask(p2.id, "K3");
  s.deleteCard(p2.id);
  assert.equal(s.getBoard(a).columns.flatMap((c) => c.cards).find((c) => c.id === k3.id)!.parentId, null);
});
