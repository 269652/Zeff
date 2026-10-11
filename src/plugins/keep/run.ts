/** Google Keep's action, run: the note made on your board (by name; else the first; else a new "Notizen"). Server only. */
import type { TodoOp } from "@/lib/boards/shared";
import { t } from "@/lib/i18n/server";
import type { ActionResult } from "../actions/run-types";
import { createKeepBoard, createOwnNote, keepBoard, listKeepBoards } from "./boards";

export async function runKeepNote(op: Extract<TodoOp, { type: "keep-note" }>): Promise<ActionResult> {
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
