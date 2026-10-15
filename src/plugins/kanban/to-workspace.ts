import path from "node:path";
import { getSqlite } from "@/db";
import { accountDir, currentAccountId } from "@/db/accounts";
import { getPref, setPref } from "@/lib/prefs";
import { collectionItems, listCollections, setCollection } from "@/lib/items";
import { isInstalled, setInstalled } from "@/plugins/state";
import { markdownToDoc } from "@/plugins/workspace/doc";
import { COLORS, newId, newProperty, newView, type DbSchema, type Option, type Property } from "@/plugins/workspace/model";
import { addRow, archivePage, createPage, getDatabase, setCell, updatePage, updateSchema } from "@/plugins/workspace/store";
import { KEY_PROP } from "@/plugins/workspace/collections";
import { cardRef, PRIORITIES, PRIORITY_LABELS, type BoardSummary, type CardView } from "./shared";
import { getBoard, listArchivedCards, listBoards, updateBoard } from "./store";

/**
 * A Kanban board moved into the Workspace: a database with a board view by status — the columns its
 * status options (the first "to do", done columns "done", the others "doing"), the cards its rows
 * with their key (KB-<id>) kept, the description as the row's page, subtasks by a relation "Parent".
 * Archived cards go to the trash (restorable). The board is archived, not deleted; what became of
 * each card is kept (kanban_moved), so moving it again changes nothing.
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

/** A Kanban time (SQLite's "2026-09-01 08:00:00", UTC) as the Workspace keeps it (ISO). */
const iso = (t: string) => new Date(t.includes("T") ? t : `${t.replace(" ", "T")}Z`).toISOString();
/** Where an old link to a moved board (or one of its cards, `card`) leads now: its database (the card's row open over it); null: not moved. */
export function movedHref(boardId: number, card?: string | null): string | null {
  const dbId = movedBoard(boardId);
  if (!dbId) return null;
  const row = card && /^\d+$/.test(card) ? movedCard(Number(card)) : null;
  return row ? `/workspace/${dbId}?row=${row}` : `/workspace/${dbId}`;
}

/** The Workspace's boards (databases with a board view by status) as Kanban's overview lists them. */
export function workspaceBoards(): BoardSummary[] {
  return listCollections({ plugin: "workspace" })
    .filter((c) => c.kind === "board")
    .map((c) => {
      const items = collectionItems(c.id) ?? [];
      return { id: c.id, name: c.name, description: c.description, color: c.color ?? "indigo", source: "Workspace", cards: items.length, open: items.filter((i) => i.status?.phase !== "done").length, href: c.href, updatedAt: null };
    });
}

const option = (name: string, color: string, group?: Option["group"]): Option => ({ id: newId("o"), name, color, ...(group ? { group } : {}) });
const prop = (name: string, type: Property["type"], options?: Option[]): Property => ({ ...newProperty(name, type), ...(options ? { options } : {}) });

export function moveBoardToWorkspace(boardId: number): { dbId: number } {
  const already = movedBoard(boardId);
  if (already) return { dbId: already };
  if (!isInstalled("workspace")) throw new Error("Moving a board needs the Workspace plugin — install it first.");
  // All or nothing: a failure halfway leaves no half-made database and the board as it was.
  return db().transaction(() => move(boardId))();
}

function move(boardId: number): { dbId: number } {
  const board = getBoard(boardId);
  const meta = listBoards({ archived: true }).find((b) => b.id === boardId)!;
  const archived = listArchivedCards(boardId);
  const cards: CardView[] = [...board.columns.flatMap((c) => c.cards), ...archived];

  const first = board.columns[0]?.id;
  const statusOf = new Map(board.columns.map((c) => [c.id, option(c.name, c.done ? "green" : c.id === first ? "gray" : "blue", c.done ? "done" : c.id === first ? "todo" : "doing")]));
  const status = prop("Status", "status", [...statusOf.values()]);
  const priorityColors: Record<string, string> = { low: "gray", normal: "blue", high: "orange", urgent: "red" };
  const priority = prop("Priority", "select", PRIORITIES.map((p) => option(PRIORITY_LABELS[p], priorityColors[p])));
  const labelNames = [...new Set(cards.flatMap((c) => c.labels))];
  const labels = prop("Labels", "multi_select", labelNames.map((n, i) => option(n, COLORS[(i + 3) % COLORS.length])));
  const due = prop("Due", "date");
  const assignee = prop("Assignee", "text");
  const key: Property = { id: KEY_PROP, name: "Key", type: "text" };
  const schema: DbSchema = {
    titleName: "Card",
    properties: [status, priority, labels, due, assignee, key],
    views: [{ ...newView("Board", "board"), groupBy: status.id, hidden: [key.id] }, newView("Table", "table")],
  };
  const dbId = createPage({ kind: "database", title: board.name, schema });
  const parent: Property = { ...prop("Parent", "relation"), relationDb: dbId };
  updateSchema(dbId, { ...schema, properties: [...schema.properties, parent] });

  const d = db();
  const rows = new Map<number, number>();
  for (const c of cards) {
    const rowId = addRow(dbId, {
      title: c.title,
      cells: {
        [status.id]: statusOf.get(c.columnId)?.id,
        [priority.id]: c.priority ? priority.options![PRIORITIES.indexOf(c.priority)].id : undefined,
        [labels.id]: c.labels.map((l) => labels.options!.find((o) => o.name === l)!.id),
        [due.id]: c.due ?? undefined,
        [assignee.id]: c.assignee ?? undefined,
        [key.id]: cardRef(c.id),
      },
    });
    if (c.description.trim()) updatePage(rowId, { content: markdownToDoc(c.description) });
    rows.set(c.id, rowId);
    d.prepare("insert or replace into kanban_moved (card_id, page_id) values (?, ?)").run(c.id, rowId);
  }
  for (const c of cards) if (c.parentId && rows.has(c.parentId)) setCell(rows.get(c.id)!, parent.id, [rows.get(c.parentId)!]);
  for (const c of archived) archivePage(rows.get(c.id)!);
  // When each card was made and last changed (else all would look changed just now — done ones done today).
  const times = d.prepare("update ws_pages set created_at = ?, updated_at = ? where id = ?");
  for (const c of cards) times.run(iso(c.createdAt), iso(c.updatedAt), rows.get(c.id)!);

  d.prepare("insert or replace into kanban_moved_boards (board_id, db_id) values (?, ?)").run(boardId, dbId);
  setCollection(`workspace:${dbId}`, { briefing: meta.inLage });
  updateBoard(boardId, { archived: true });
  return { dbId };
}

const MOVED_ALL = "kanban.movedToWorkspace";

/**
 * Once per account (at a server start): every Kanban board that isn't archived moves into the
 * Workspace — after a copy of the database next to it (zeff-before-kanban-move.db), with the
 * Workspace turned on. Archived boards stay in Kanban's archive. A board that fails is logged and
 * the next start tries again; null: done already (or Kanban isn't installed).
 */
export async function moveAllBoardsOnce(): Promise<{ moved: number; failed: number; backup: string | null } | null> {
  if (getPref<boolean>(MOVED_ALL, false) || !isInstalled("kanban")) return null;
  const boards = listBoards().filter((b) => !movedBoard(b.id));
  let backup: string | null = null;
  if (boards.length) {
    backup = path.join(accountDir(currentAccountId()), "zeff-before-kanban-move.db");
    await getSqlite().backup(backup);
    if (!isInstalled("workspace")) setInstalled("workspace", true);
  }
  let failed = 0;
  for (const b of boards) {
    try {
      moveBoardToWorkspace(b.id);
    } catch (e) {
      failed++;
      console.error(`[kanban] moving board ${b.id} “${b.name}” into the Workspace failed`, e);
    }
  }
  if (!failed) setPref(MOVED_ALL, true);
  return { moved: boards.length - failed, failed, backup };
}

/** A board was made in Kanban: once the boards have moved (and the Workspace is there), it goes into the Workspace too. */
export function boardCreated(boardId: number): void {
  if (getPref<boolean>(MOVED_ALL, false) && isInstalled("workspace")) moveBoardToWorkspace(boardId);
}
