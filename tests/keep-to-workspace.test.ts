import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * Keep's boards are in the Workspace (moved in 2026-10, nothing makes new ones): a board a notes database, its notes rows that
 * keep their ref (keep:n<id>). What became of each (keep_moved_boards, keep_moved) is still read — set up here as the move left it.
 */
async function moved(boardName: string, notes: { title: string; text: string }[] = []) {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["keep", "workspace"]) setInstalled(id, true);
  const k = await import("@/plugins/keep/boards");
  const w = await import("@/plugins/workspace/store");
  const { notesBoardSchema } = await import("@/plugins/workspace/notes-board");
  const { getSqlite } = await import("@/db");
  const { movedKeepBoard } = await import("@/plugins/workspace/legacy/keep");
  movedKeepBoard(0); // (its tables made)
  const board = k.createKeepBoard({ name: boardName });
  const { schema, ref } = notesBoardSchema();
  const dbId = w.createPage({ kind: "database", title: boardName, schema });
  const made = notes.map((n) => {
    const note = k.createOwnNote(board, n);
    const row = w.addRow(dbId, { title: n.title, cells: { [ref.id]: note.ref } });
    getSqlite().prepare("insert into keep_moved (note_id, page_id) values (?, ?)").run(Number(note.id.slice(1)), row);
    return { note, row };
  });
  getSqlite().prepare("insert into keep_moved_boards (board_id, db_id) values (?, ?)").run(board, dbId);
  k.updateKeepBoard(board, { archived: true });
  return { board, dbId, made };
}

test("a moved board: its database, old links lead there, a note's row", async () => {
  const { movedKeepBoard, movedKeepHref, movedNote, movedNoteDatabases } = await import("@/plugins/workspace/legacy/keep");
  const { board, dbId, made } = await moved("Ideen", [{ title: "Einkauf", text: "- [ ] Milch" }]);
  assert.equal(movedKeepBoard(board), dbId);
  assert.equal(movedKeepHref(board), `/workspace/${dbId}`);
  assert.equal(movedKeepHref(424242), null, "not moved: no link");
  assert.equal(movedNote(Number(made[0].note.id.slice(1))), made[0].row);
  assert.ok(movedNoteDatabases().some((d) => d.dbId === dbId && d.name === "Ideen"));
});

/** Keep itself no longer answers for a moved note — not by luck of the order the plugins register in. */
test("keep's provider leaves moved notes to the Workspace", async () => {
  const k = await import("@/plugins/keep/boards");
  const { keepCollections } = await import("@/plugins/keep/collections");
  const { made } = await moved("Weg", [{ title: "Notiz", text: "x" }]);
  const stays = k.createOwnNote(k.createKeepBoard({ name: "Bleibt" }), { title: "Bleibt", text: "y" });
  assert.deepEqual(keepCollections.byRefs([made[0].note.ref, stays.ref]).map((i) => i.ref), [stays.ref]);
});

/** The auto-action "Create note" writes into the moved board's database (by name), not into an archived Keep board. */
test("runKeepNote: the note is a row of the moved board's database", async () => {
  const k = await import("@/plugins/keep/boards");
  const w = await import("@/plugins/workspace/store");
  const { docToMarkdown } = await import("@/plugins/workspace/doc");
  const { runKeepNote } = await import("@/plugins/keep/run");
  const { dbId } = await moved("Einkaufsliste");
  const before = k.listKeepBoards().length;
  const r = await runKeepNote({ type: "keep-note", board: "einkaufsliste", title: "Baumarkt", text: "- [ ] Schrauben" } as never);
  const row = w.rawRows(dbId).find((x) => x.title === "Baumarkt");
  assert.ok(row, "a row of the moved board's database");
  assert.match(docToMarkdown(w.getPage(row.id)!.content), /- \[ \] Schrauben/);
  assert.equal(r.ref, `page:${row.id}`);
  assert.equal(k.listKeepBoards().length, before, "no new Keep board made");
});
