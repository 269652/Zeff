import path from "node:path";
import { getSqlite } from "@/db";
import { accountDir, currentAccountId } from "@/db/accounts";
import { setCollection } from "@/lib/items";
import { getPref, setPref } from "@/lib/prefs";
import { isInstalled, setInstalled } from "@/plugins/state";
import { COLOR_PROP, NOTE_PROP, PINNED_PROP } from "@/plugins/workspace/collections";
import { markdownToDoc } from "@/plugins/workspace/doc";
import { COLORS, newId, newProperty, newView, type DbSchema, type Option, type Property } from "@/plugins/workspace/model";
import { addRow, archivePage, createPage, getDatabase, updatePage } from "@/plugins/workspace/store";
import { listKeepBoards, listOwnNotes, updateKeepBoard, type NoteView } from "./boards";
import { KEEP_COLORS } from "./colors";

/**
 * A Keep board moved into the Workspace: a database with a gallery view (pinned on top) — its notes
 * rows that keep their ref (keep:n<id>, in the property `noteref`), their colour, pinned and labels
 * as properties, text and checklists as the row's page. Archived notes go to the trash
 * (restorable). The board is archived, not deleted; what became of each note is kept (keep_moved),
 * so moving it again changes nothing.
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

/** Keep's colours as the Workspace's (those it has; teal and cerulean nearest). */
const WS_COLOR: Record<string, string> = { teal: "green", cerulean: "blue" };
const wsColor = (c: string) => WS_COLOR[c] ?? ((COLORS as readonly string[]).includes(c) ? c : "gray");
/** A Keep time as the Workspace keeps it (ISO). */
const iso = (t: string | null) => new Date(t && !t.includes("T") ? `${t.replace(" ", "T")}Z` : (t ?? Date.now())).toISOString();
const option = (name: string, color: string): Option => ({ id: newId("o"), name, color });

export function moveKeepBoardToWorkspace(boardId: number): { dbId: number } {
  const already = movedKeepBoard(boardId);
  if (already) return { dbId: already };
  if (!isInstalled("workspace")) throw new Error("Moving a board needs the Workspace plugin — install it first.");
  // All or nothing: a failure halfway leaves no half-made database and the board as it was.
  return db().transaction(() => move(boardId))();
}

function move(boardId: number): { dbId: number } {
  const board = listKeepBoards({ archived: true }).find((b) => b.id === boardId);
  if (!board) throw new Error("That board doesn't exist.");
  const live = listOwnNotes(boardId);
  const archived = listOwnNotes(boardId, { archived: true });
  const notes: NoteView[] = [...live, ...archived];

  const color: Property = { id: COLOR_PROP, name: "Color", type: "select", options: Object.keys(KEEP_COLORS).map((c) => option(c, wsColor(c))) };
  const pinned: Property = { id: PINNED_PROP, name: "Pinned", type: "checkbox" };
  const labels: Property = { ...newProperty("Labels", "multi_select"), options: [...new Set(notes.flatMap((n) => n.labels))].map((n, i) => option(n, COLORS[(i + 3) % COLORS.length])) };
  const ref: Property = { id: NOTE_PROP, name: "Note", type: "text" };
  const schema: DbSchema = {
    titleName: "Title",
    properties: [color, pinned, labels, ref],
    views: [{ ...newView("Notes", "gallery"), sorts: [{ prop: pinned.id, dir: "desc" }], hidden: [ref.id, pinned.id] }, newView("Table", "table")],
  };
  const dbId = createPage({ kind: "database", title: board.name, schema });
  updatePage(dbId, { fullWidth: true }); // the notes use the whole width, as Keep's did

  const d = db();
  const rows = new Map<string, number>();
  for (const n of notes) {
    const rowId = addRow(dbId, {
      title: n.title || n.text.split("\n")[0].slice(0, 120),
      cells: {
        [color.id]: n.color ? color.options!.find((o) => o.name === n.color)?.id : undefined,
        [pinned.id]: n.pinned || undefined,
        [labels.id]: n.labels.map((l) => labels.options!.find((o) => o.name === l)!.id),
        [ref.id]: n.ref,
      },
    });
    if (n.text.trim()) updatePage(rowId, { content: markdownToDoc(n.text) });
    rows.set(n.ref, rowId);
    d.prepare("insert or replace into keep_moved (note_id, page_id) values (?, ?)").run(Number(n.id.slice(1)), rowId);
  }
  for (const n of archived) archivePage(rows.get(n.ref)!);
  // When each note was made and last changed (the note review reads a note again only once it's changed).
  const times = d.prepare("update ws_pages set created_at = ?, updated_at = ? where id = ?");
  for (const n of notes) times.run(iso(n.createdAt), iso(n.updatedAt), rows.get(n.ref)!);

  d.prepare("insert or replace into keep_moved_boards (board_id, db_id) values (?, ?)").run(boardId, dbId);
  setCollection(`workspace:${dbId}`, { briefing: board.inLage, knowledge: board.inKnowledge });
  updateKeepBoard(boardId, { archived: true });
  return { dbId };
}

const MOVED_ALL = "keep.movedToWorkspace";

/**
 * Once per account (at a server start): every Keep board of yours that isn't archived moves into the
 * Workspace — after a copy of the database next to it (zeff-before-keep-move.db), with the Workspace
 * turned on. A board that fails is logged and the next start tries again; null: done already (or Keep
 * isn't installed).
 */
export async function moveAllKeepBoardsOnce(): Promise<{ moved: number; failed: number; backup: string | null } | null> {
  if (getPref<boolean>(MOVED_ALL, false) || !isInstalled("keep")) return null;
  const boards = listKeepBoards().filter((b) => !movedKeepBoard(b.id));
  let backup: string | null = null;
  if (boards.length) {
    backup = path.join(accountDir(currentAccountId()), "zeff-before-keep-move.db");
    await getSqlite().backup(backup);
    if (!isInstalled("workspace")) setInstalled("workspace", true);
  }
  let failed = 0;
  for (const b of boards) {
    try {
      moveKeepBoardToWorkspace(b.id);
    } catch (e) {
      failed++;
      console.error(`[keep] moving board ${b.id} “${b.name}” into the Workspace failed`, e);
    }
  }
  if (!failed) setPref(MOVED_ALL, true);
  return { moved: boards.length - failed, failed, backup };
}
