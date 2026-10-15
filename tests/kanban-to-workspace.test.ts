import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * Kanban → Workspace: a board becomes a database with a board view — its columns the status
 * options, its cards rows (KB-<id> kept as their key), the description the row's page. The board is
 * archived, not deleted: nothing is lost, and moving it again changes nothing.
 */
test("a Kanban board moves into the Workspace as a database, its cards as rows", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["kanban", "workspace"]) setInstalled(id, true);
  const s = await import("@/plugins/kanban/store");
  const w = await import("@/plugins/workspace/store");
  const { docToMarkdown } = await import("@/plugins/workspace/doc");
  const c = await import("@/lib/items");
  const { moveBoardToWorkspace, movedCard } = await import("@/plugins/kanban/to-workspace");

  const b = s.createBoard({ name: "Haus", description: "Renovierung", columns: ["Offen", "Dran", "Fertig"] });
  const [open, doing, done] = s.getBoard(b).columns;
  s.updateColumn(done.id, { done: true });
  const tiles = s.createCard(open.id, "Fliesen kaufen");
  s.updateCard(tiles.id, { description: "Für das **Bad**\n\n- weiß\n- matt", labels: ["Bad", "Einkauf"], priority: "high", due: "2026-11-01", assignee: "Anna" });
  const grout = s.createSubtask(tiles.id, "Fugen");
  const paint = s.createCard(doing.id, "Streichen");
  const old = s.createCard(done.id, "Alt");
  s.archiveCard(old.id);

  const { dbId } = moveBoardToWorkspace(b);
  const d = w.getDatabase(dbId)!;
  assert.equal(d.page.title, "Haus");
  const prop = (name: string) => d.schema.properties.find((p) => p.name === name)!;
  const status = prop("Status");
  assert.deepEqual(status.options!.map((o) => [o.name, o.group]), [["Offen", "todo"], ["Dran", "doing"], ["Fertig", "done"]]);
  assert.deepEqual(prop("Priority").options!.map((o) => o.name), ["Low", "Normal", "High", "Urgent"]);
  assert.deepEqual(prop("Labels").options!.map((o) => o.name).sort(), ["Bad", "Einkauf"]);
  assert.equal(prop("Parent").relationDb, dbId, "subtasks: a relation within the database");
  const board = d.schema.views.find((v) => v.type === "board")!;
  assert.equal(board.groupBy, status.id, "a board view by status");
  assert.equal(d.schema.views[0].id, board.id, "the board view first");

  const rows = w.rawRows(dbId);
  assert.deepEqual(rows.map((r) => r.title), ["Fliesen kaufen", "Fugen", "Streichen"], "the archived card isn't among the rows");
  const row = (cardId: number) => rows.find((r) => r.id === movedCard(cardId))!;
  const r = row(tiles.id);
  assert.equal(r.cells[prop("Key").id], `KB-${tiles.id}`, "its key stays");
  assert.equal(r.cells[status.id], status.options![0].id);
  assert.equal(r.cells[prop("Due").id], "2026-11-01");
  assert.equal(r.cells[prop("Assignee").id], "Anna");
  assert.equal(r.cells[prop("Priority").id], prop("Priority").options![2].id);
  assert.match(docToMarkdown(w.getPage(r.id)!.content), /\*\*Bad\*\*[\s\S]*- weiß/);
  assert.deepEqual(row(grout.id).cells[prop("Parent").id], [r.id]);
  assert.equal(row(paint.id).cells[status.id], status.options![1].id);
  assert.ok(w.getPage(movedCard(old.id)!)!.archivedAt, "an archived card: a row in the trash, restorable");

  const cols = c.listCollections();
  assert.ok(!cols.some((x) => x.id === `kanban:${b}`), "the Kanban board is archived");
  assert.ok(s.listBoards({ archived: true }).some((x) => x.id === b), "but not deleted");
  const moved = cols.find((x) => x.id === `workspace:${dbId}`)!;
  assert.equal(moved.briefing, true, "in the Lage: in the briefing");
  assert.deepEqual(c.collectionItems(moved.id)!.map((i) => i.status?.phase), ["todo", "todo", "doing"]);

  assert.equal(moveBoardToWorkspace(b).dbId, dbId, "moved again: the same database");
  assert.equal(w.rawRows(dbId).length, 3, "nothing doubled");
});

/** Without the Workspace plugin nothing is moved — not half of it. */
test("moving needs the Workspace: without it, nothing is made and the board stays", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("kanban", true);
  setInstalled("workspace", false);
  const s = await import("@/plugins/kanban/store");
  const w = await import("@/plugins/workspace/store");
  const { moveBoardToWorkspace } = await import("@/plugins/kanban/to-workspace");
  const b = s.createBoard({ name: "Bleibt" });
  s.createCard(s.getBoard(b).columns[0].id, "Karte");
  const before = w.tree().length;

  assert.throws(() => moveBoardToWorkspace(b), /Workspace/);
  assert.equal(w.tree().length, before, "no database made");
  assert.ok(s.listBoards().some((x) => x.id === b), "the board is still there");
});
