/** The "Create note" action, run: a row of a notes database in the Workspace (your Keep boards became those). Server only. */
import type { TodoOp } from "@/lib/todos/shared";
import { t } from "@/lib/i18n/server";
import { getPref, setPref } from "@/lib/prefs";
import type { ActionResult } from "../actions/run-types";

/** The notes database the action made itself when there was none (no Keep board had moved). */
const OWN_DB = "keep.notesDb";

/** The notes databases to write into: the boards that moved, else the one made for this (made now if need be). */
async function noteDatabases(): Promise<{ dbId: number; name: string }[]> {
  const moved = (await import("@/plugins/workspace/legacy/keep")).movedNoteDatabases();
  if (moved.length) return moved;
  const { createPage, getDatabase, updatePage } = await import("@/plugins/workspace/store");
  const known = getPref<number | null>(OWN_DB, null);
  const d = known ? getDatabase(known) : null;
  if (d && !d.page.archivedAt) return [{ dbId: known!, name: d.page.title }];
  const { notesBoardSchema } = await import("@/plugins/workspace/notes-board");
  const dbId = createPage({ kind: "database", title: "Notes", schema: notesBoardSchema().schema });
  updatePage(dbId, { fullWidth: true });
  setPref(OWN_DB, dbId);
  return [{ dbId, name: "Notes" }];
}

export async function runKeepNote(op: Extract<TodoOp, { type: "keep-note" }>): Promise<ActionResult> {
  // The note is a row of the board's database (by name; else the first).
  const dbs = await noteDatabases();
  const want = op.board.trim().toLowerCase();
  const target = (want && dbs.find((d) => d.name.toLowerCase() === want)) || dbs[0];
  const { addRow, updatePage } = await import("@/plugins/workspace/store");
  const { markdownToDoc } = await import("@/plugins/workspace/doc");
  const title = op.title?.trim() || op.text.split("\n")[0].slice(0, 120);
  const row = addRow(target.dbId, { title });
  if (op.text.trim()) updatePage(row, { content: markdownToDoc(op.text) });
  return { what: t("Note “{title}” created in {board}", { title, board: target.name }), ref: `page:${row}`, todoNote: `Note created in the Workspace (${target.name}): “${title}”.` };
}
