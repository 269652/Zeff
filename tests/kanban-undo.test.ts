import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

test("a deleted card comes back from its snapshot (same id, column, fields, subtasks); an archived one unarchives", async () => {
  const s = await import("@/plugins/kanban/store");
  const b = s.createBoard({ name: "A" });
  const [open, doing] = s.getBoard(b).columns;
  const parent = s.createCard(open.id, "Parent");
  s.updateCard(parent.id, { description: "Text", labels: ["x", "y"], priority: "high", due: "2026-12-01", assignee: "Ann" });
  s.moveCard(parent.id, doing.id, null);
  const kid = s.createSubtask(parent.id, "Kid");
  const snap = s.snapshotCard(parent.id);
  s.deleteCard(parent.id);
  const all = () => s.getBoard(b).columns.flatMap((c) => c.cards);
  assert.equal(all().some((c) => c.id === parent.id), false);
  assert.equal(all().find((c) => c.id === kid.id)!.parentId, null);

  s.restoreCard(snap);
  const back = all().find((c) => c.id === parent.id)!;
  assert.deepEqual([back.columnId, back.title, back.description, back.labels, back.priority, back.due, back.assignee, back.sort], [doing.id, "Parent", "Text", ["x", "y"], "high", "2026-12-01", "Ann", snap.sort]);
  assert.equal(back.ref, parent.ref);
  assert.equal(all().find((c) => c.id === kid.id)!.parentId, parent.id, "the subtask is linked again");
  assert.throws(() => s.restoreCard(snap), /exists already/);

  s.archiveCard(parent.id);
  assert.equal(all().some((c) => c.id === parent.id), false);
  s.unarchiveCard(parent.id);
  assert.equal(all().some((c) => c.id === parent.id), true);
});
