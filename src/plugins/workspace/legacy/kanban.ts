import { getSqlite } from "@/db";
import { getDatabase } from "@/plugins/workspace/store";

/**
 * What is left of the Kanban plugin: its boards moved into the Workspace (every board of both accounts, 2026-10 — nothing makes new
 * ones), each a database with a board view, its cards rows with their key (KB-<id>) kept. What became of each board and card
 * (kanban_moved_boards, kanban_moved) is still read: old links (/kanban/<board>?card=<id>, kept in runs and pages) lead there.
 */

function db() {
  const d = getSqlite();
  d.exec(`
    create table if not exists kanban_moved_boards (board_id integer primary key, db_id integer not null);
    create table if not exists kanban_moved (card_id integer primary key, page_id integer not null);
  `);
  return d;
}

/** The row a card became (null: not moved). */
export const movedCard = (cardId: number): number | null => (db().prepare("select page_id from kanban_moved where card_id = ?").get(cardId) as { page_id: number } | undefined)?.page_id ?? null;

/** The database a board became (null: not moved, or the database is gone). */
export function movedBoard(boardId: number): number | null {
  const r = db().prepare("select db_id from kanban_moved_boards where board_id = ?").get(boardId) as { db_id: number } | undefined;
  return r && getDatabase(r.db_id) ? r.db_id : null;
}

/** Where an old link to a board (/kanban/<id>, a card's ?card=<id>) leads now: its database, the card's row open over it; null: not moved. */
export function movedHref(boardId: number, card?: string | null): string | null {
  const dbId = movedBoard(boardId);
  if (!dbId) return null;
  const row = card && /^\d+$/.test(card) ? movedCard(Number(card)) : null;
  return row ? `/workspace/${dbId}?row=${row}` : `/workspace/${dbId}`;
}
