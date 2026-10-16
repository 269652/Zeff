/** Google Keep's action, run: the note made on your board (by name; else the first; else a new "Notizen"). Server only. */
import type { TodoOp } from "@/lib/boards/shared";
import { t } from "@/lib/i18n/server";
import type { ActionResult } from "../actions/run-types";
import { createKeepBoard, createOwnNote, keepBoard, listKeepBoards } from "./boards";

export async function runKeepNote(op: Extract<TodoOp, { type: "keep-note" }>): Promise<ActionResult> {
  // Keep's boards moved into the Workspace: the note is a row of the board's database (by name; else the first).
  const { movedNoteDatabases } = await import("./to-workspace");
  const dbs = movedNoteDatabases();
  if (dbs.length) {
    const want = op.board.trim().toLowerCase();
    const target = (want && dbs.find((d) => d.name.toLowerCase() === want)) || dbs[0];
    const { addRow, updatePage } = await import("@/plugins/workspace/store");
    const { markdownToDoc } = await import("@/plugins/workspace/doc");
    const title = op.title?.trim() || op.text.split("\n")[0].slice(0, 120);
    const row = addRow(target.dbId, { title });
    if (op.text.trim()) updatePage(row, { content: markdownToDoc(op.text) });
    return { what: t("Note “{title}” created in {board}", { title, board: target.name }), ref: `page:${row}`, todoNote: `Note created in the Workspace (${target.name}): “${title}”.` };
  }
  const boards = listKeepBoards();
  const wanted = op.board.trim().toLowerCase();
  const board = (wanted && boards.find((b) => b.name.toLowerCase() === wanted)) || boards[0] || keepBoard(createKeepBoard({ name: "Notes" }))!;
  const n = createOwnNote(board.id, { title: op.title, text: op.text });
  return {
    what: t("Note “{title}” created in {board}", { title: n.title || n.text.split("\n")[0].slice(0, 60), board: board.name }),
    ref: n.ref,
    todoNote: `Note created in Keep (${board.name}): “${n.title || n.text.split("\n")[0].slice(0, 60)}”.`,
  };
}
