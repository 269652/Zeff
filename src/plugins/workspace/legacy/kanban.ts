import path from "node:path";
import { getSqlite } from "@/db";
import { accountDir, currentAccountId } from "@/db/accounts";
import { getPref, setPref } from "@/lib/prefs";
import { setCollection } from "@/lib/items";
import { isInstalled, setInstalled } from "@/plugins/state";
import { markdownToDoc } from "@/plugins/workspace/doc";
import { COLORS, newId, newProperty, newView, type DbSchema, type Option, type Property } from "@/plugins/workspace/model";
import { addRow, archivePage, createPage, getDatabase, setCell, updatePage, updateSchema } from "@/plugins/workspace/store";
import { KEY_PROP } from "@/plugins/workspace/collections";

/**
 * What is left of the Kanban plugin: its boards moved into the Workspace. A board became a database with a board view by
 * status — the columns its status options (the first "to do", done columns "done", the others "doing"), the cards its
 * rows with their key (KB-<id>) kept, the description as the row's page, subtasks by a relation "Parent". Archived
 * cards go to the trash (restorable); a board you had archived becomes a database "… (archived)". Kanban's tables are
 * only read here, never changed but for the board's archived flag; what became of each card is kept (kanban_moved),
 * so moving again changes nothing. Runs at every start (instrumentation) until every board has moved.
 */

function db() {
  const d = getSqlite();
  d.exec(`
    create table if not exists kanban_moved_boards (board_id integer primary key, db_id integer not null);
    create table if not exists kanban_moved (card_id integer primary key, page_id integer not null);
  `);
  return d;
}

const hasKanban = () => !!getSqlite().prepare("select 1 from sqlite_master where type = 'table' and name = 'kanban_boards'").get();

type Board = { id: number; name: string; archived: number; in_lage: number };
type Column = { id: number; name: string; done: number };
type Card = { id: number; column_id: number; title: string; description: string; labels: string; priority: string | null; due: string | null; assignee: string | null; parent_id: number | null; archived: number; created_at: string; updated_at: string };

const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
const PRIORITY_LABELS: Record<string, string> = { low: "Low", normal: "Normal", high: "High", urgent: "Urgent" };
const PRIORITY_COLORS: Record<string, string> = { low: "gray", normal: "blue", high: "orange", urgent: "red" };
const cardRef = (id: number) => `KB-${id}`;
const labelsOf = (raw: string): string[] => {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};

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

/** A Kanban time (SQLite's "2026-09-01 08:00:00", UTC) as the Workspace keeps it (ISO). */
const iso = (t: string) => new Date(t.includes("T") ? t : `${t.replace(" ", "T")}Z`).toISOString();
const option = (name: string, color: string, group?: Option["group"]): Option => ({ id: newId("o"), name, color, ...(group ? { group } : {}) });
const prop = (name: string, type: Property["type"], options?: Option[]): Property => ({ ...newProperty(name, type), ...(options ? { options } : {}) });

export function moveBoardToWorkspace(boardId: number): { dbId: number } {
  const already = movedBoard(boardId);
  if (already) return { dbId: already };
  // All or nothing: a failure halfway leaves no half-made database and the board as it was.
  return db().transaction(() => move(boardId))();
}

function move(boardId: number): { dbId: number } {
  const d = db();
  const board = d.prepare("select id, name, archived, in_lage from kanban_boards where id = ?").get(boardId) as Board | undefined;
  if (!board) throw new Error("That board doesn't exist.");
  const columns = d.prepare("select id, name, done from kanban_columns where board_id = ? order by sort, id").all(boardId) as Column[];
  const known = new Set(columns.map((c) => c.id));
  const cards = (d.prepare("select * from kanban_cards where board_id = ? order by archived, sort, id").all(boardId) as Card[]).filter((c) => known.has(c.column_id));

  const first = columns[0]?.id;
  const statusOf = new Map(columns.map((c) => [c.id, option(c.name, c.done ? "green" : c.id === first ? "gray" : "blue", c.done ? "done" : c.id === first ? "todo" : "doing")]));
  const status = prop("Status", "status", [...statusOf.values()]);
  const priority = prop("Priority", "select", PRIORITIES.map((p) => option(PRIORITY_LABELS[p], PRIORITY_COLORS[p])));
  const labelNames = [...new Set(cards.flatMap((c) => labelsOf(c.labels)))];
  const labels = prop("Labels", "multi_select", labelNames.map((n, i) => option(n, COLORS[(i + 3) % COLORS.length])));
  const due = prop("Due", "date");
  const assignee = prop("Assignee", "text");
  const key: Property = { id: KEY_PROP, name: "Key", type: "text" };
  const schema: DbSchema = {
    titleName: "Card",
    properties: [status, priority, labels, due, assignee, key],
    views: [{ ...newView("Board", "board"), groupBy: status.id, hidden: [key.id] }, newView("Table", "table")],
  };
  const dbId = createPage({ kind: "database", title: board.archived ? `${board.name} (archived)` : board.name, schema });
  updatePage(dbId, { fullWidth: true }); // a board uses the whole width, as Kanban did
  const parent: Property = { ...prop("Parent", "relation"), relationDb: dbId };
  updateSchema(dbId, { ...schema, properties: [...schema.properties, parent] });

  const rows = new Map<number, number>();
  for (const c of cards) {
    const p = (PRIORITIES as readonly string[]).indexOf(c.priority ?? "");
    const rowId = addRow(dbId, {
      title: c.title,
      cells: {
        [status.id]: statusOf.get(c.column_id)?.id,
        [priority.id]: p >= 0 ? priority.options![p].id : undefined,
        [labels.id]: labelsOf(c.labels).map((l) => labels.options!.find((o) => o.name === l)!.id),
        [due.id]: c.due ?? undefined,
        [assignee.id]: c.assignee ?? undefined,
        [key.id]: cardRef(c.id),
      },
    });
    if (c.description.trim()) updatePage(rowId, { content: markdownToDoc(c.description) });
    rows.set(c.id, rowId);
    d.prepare("insert or replace into kanban_moved (card_id, page_id) values (?, ?)").run(c.id, rowId);
  }
  for (const c of cards) if (c.parent_id && rows.has(c.parent_id)) setCell(rows.get(c.id)!, parent.id, [rows.get(c.parent_id)!]);
  for (const c of cards) if (c.archived) archivePage(rows.get(c.id)!);
  // When each card was made and last changed (else all would look changed just now — done ones done today).
  const times = d.prepare("update ws_pages set created_at = ?, updated_at = ? where id = ?");
  for (const c of cards) times.run(iso(c.created_at), iso(c.updated_at), rows.get(c.id)!);

  d.prepare("insert or replace into kanban_moved_boards (board_id, db_id) values (?, ?)").run(boardId, dbId);
  setCollection(`workspace:${dbId}`, { briefing: !board.archived && !!board.in_lage });
  d.prepare("update kanban_boards set archived = 1 where id = ?").run(boardId);
  return { dbId };
}

/**
 * At a server start, per account: every Kanban board not moved yet (archived ones too) moves into the Workspace —
 * after a copy of the database next to it (zeff-before-kanban-move.db), with the Workspace turned on. A board that
 * fails is logged and the next start tries again; null: nothing (left) to move.
 */
export async function moveAllBoardsOnce(): Promise<{ moved: number; failed: number; backup: string | null } | null> {
  if (!hasKanban()) return null;
  const moved = new Set((db().prepare("select board_id from kanban_moved_boards").all() as { board_id: number }[]).map((r) => r.board_id));
  const boards = (getSqlite().prepare("select id, name from kanban_boards order by sort, id").all() as { id: number; name: string }[]).filter((b) => !moved.has(b.id));
  if (!boards.length) return null;
  const backup = path.join(accountDir(currentAccountId()), "zeff-before-kanban-move.db");
  await getSqlite().backup(backup);
  if (!isInstalled("workspace")) setInstalled("workspace", true);
  let failed = 0;
  for (const b of boards) {
    try {
      moveBoardToWorkspace(b.id);
    } catch (e) {
      failed++;
      console.error(`[kanban] moving board ${b.id} “${b.name}” into the Workspace failed`, e);
    }
  }
  if (!failed) setPref("kanban.movedToWorkspace", true);
  return { moved: boards.length - failed, failed, backup };
}

const WIDENED = "kanban.movedBoardsWidened";

/** Once: the boards moved before they got the whole width get it (narrowed later by you, they stay so). True when it ran. */
export function widenMovedBoardsOnce(): boolean {
  if (getPref<boolean>(WIDENED, false)) return false;
  for (const { db_id } of db().prepare("select db_id from kanban_moved_boards").all() as { db_id: number }[]) if (getDatabase(db_id)) updatePage(db_id, { fullWidth: true });
  setPref(WIDENED, true);
  return true;
}
