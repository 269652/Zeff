import { getSqlite } from "@/db";
import { getDatabase } from "@/plugins/workspace/store";

/**
 * What is left of the Keep boards: they moved into the Workspace (every board of both accounts, 2026-10 — nothing makes new ones),
 * each a database with a gallery view, its notes rows that keep their ref (keep:n<id>). What became of each board and note
 * (keep_moved_boards, keep_moved) is still read: Keep leaves moved notes to the Workspace, "Create note" writes into their
 * databases, old links lead there.
 */

function db() {
  const d = getSqlite();
  d.exec(`
    create table if not exists keep_moved_boards (board_id integer primary key, db_id integer not null);
    create table if not exists keep_moved (note_id integer primary key, page_id integer not null);
  `);
  return d;
}

/** The row a note of yours became (null: not moved). */
export const movedNote = (noteId: number): number | null => (db().prepare("select page_id from keep_moved where note_id = ?").get(noteId) as { page_id: number } | undefined)?.page_id ?? null;

/** The database a Keep board became (null: not moved, or the database is gone). */
export function movedKeepBoard(boardId: number): number | null {
  const r = db().prepare("select db_id from keep_moved_boards where board_id = ?").get(boardId) as { db_id: number } | undefined;
  return r && getDatabase(r.db_id) ? r.db_id : null;
}

/** Where an old link to a moved Keep board leads now: its database; null: not moved. */
export function movedKeepHref(boardId: number): string | null {
  const dbId = movedKeepBoard(boardId);
  return dbId ? `/workspace/${dbId}` : null;
}

/** The databases your Keep boards became (their names as now). */
export function movedNoteDatabases(): { dbId: number; name: string }[] {
  return (db().prepare("select db_id from keep_moved_boards order by board_id").all() as { db_id: number }[]).flatMap((r) => {
    const d = getDatabase(r.db_id);
    return d && !d.page.archivedAt ? [{ dbId: r.db_id, name: d.page.title }] : [];
  });
}
