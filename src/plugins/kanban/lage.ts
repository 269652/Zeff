import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Issue } from "@/lib/boards/collect";
import type { TicketCard } from "@/lib/jira/ticket-card-shared";
import { cardRef, isPriority, PRIORITY_LABELS } from "./shared";

/**
 * Your Kanban cards in the Ticket-Lage: each open card of a board that's in the Lage (and those
 * done in the last days) as a ticket KB-<id> — its column is its status, the board's columns its
 * "transitions". So they get todos, a Lage per card, a place in the Lage reports — like Jira's.
 */

const { kanbanBoards: boards, kanbanColumns: columns, kanbanCards: cards } = schema;

/** Done cards stay in the Lage this long (what got done is part of it). */
const DONE_DAYS = 3;

export type KanbanLageTicket = { issue: Issue; url: string; columns: string[]; done: boolean; board: string };

export function kanbanLageTickets(): KanbanLageTicket[] {
  const db = getDb();
  const bs = db.select().from(boards).where(and(eq(boards.archived, false), eq(boards.inLage, true))).all();
  if (!bs.length) return [];
  const cols = db.select().from(columns).where(inArray(columns.boardId, bs.map((b) => b.id))).orderBy(asc(columns.sort), asc(columns.id)).all();
  const since = Date.now() - DONE_DAYS * 864e5;
  const out: KanbanLageTicket[] = [];
  for (const c of db.select().from(cards).where(and(inArray(cards.boardId, bs.map((b) => b.id)), eq(cards.archived, false))).all()) {
    const board = bs.find((b) => b.id === c.boardId)!;
    const col = cols.find((k) => k.id === c.columnId);
    if (!col) continue;
    if (col.done && (!c.doneAt || Date.parse(c.doneAt) < since)) continue;
    const boardCols = cols.filter((k) => k.boardId === board.id);
    const first = boardCols[0]?.id === col.id;
    let labels: string[] = [];
    try {
      labels = JSON.parse(c.labels) as string[];
    } catch {
      labels = [];
    }
    const iso = (t: string) => (t.includes("T") ? t : `${t.replace(" ", "T")}Z`);
    const key = cardRef(c.id);
    out.push({
      board: board.name,
      done: col.done,
      columns: boardCols.filter((k) => k.id !== col.id).map((k) => k.name),
      url: `/kanban/${board.id}?card=${c.id}`,
      issue: {
        key,
        summary: c.title,
        description: [
          `Eigene Kanban-Karte in Zeff (Board „${board.name}“${board.description ? ` — ${board.description}` : ""}), kein Jira-Ticket.`,
          labels.length ? `Labels: ${labels.join(", ")}` : "",
          c.due ? `Fällig: ${c.due}` : "",
          c.description,
        ]
          .filter(Boolean)
          .join("\n"),
        browse_url: `/kanban/${board.id}?card=${c.id}`,
        status: { name: col.name, category: col.done ? "done" : first ? "todo" : "inprogress" },
        issue_type: { name: "Kanban-Karte" },
        priority: isPriority(c.priority) ? { name: PRIORITY_LABELS[c.priority] } : undefined,
        assignee: c.assignee ? { display_name: c.assignee } : undefined,
        created: iso(c.createdAt),
        updated: iso(c.updatedAt),
        comments: [],
      },
    });
  }
  return out;
}

/** Kanban cards as ticket cards (KB-…): their title, column, description — for hover cards and links like Jira's. */
export function kanbanTicketCards(keys: string[]): Record<string, TicketCard> {
  const ids = keys.flatMap((k) => {
    const m = /^KB-(\d+)$/i.exec(k);
    return m ? [Number(m[1])] : [];
  });
  if (!ids.length) return {};
  const db = getDb();
  const rows = db
    .select({ c: cards, col: columns, board: boards })
    .from(cards)
    .innerJoin(columns, eq(columns.id, cards.columnId))
    .innerJoin(boards, eq(boards.id, cards.boardId))
    .where(inArray(cards.id, ids))
    .all();
  const out: Record<string, TicketCard> = {};
  for (const { c, col, board } of rows) {
    const key = cardRef(c.id);
    out[key] = {
      key,
      url: `/kanban/${board.id}?card=${c.id}`,
      synced: true,
      summary: c.title,
      description: c.description || null,
      status: col.name,
      statusCategory: col.done ? "done" : "inprogress",
      issueType: `Kanban · ${board.name}`,
      priority: isPriority(c.priority) ? PRIORITY_LABELS[c.priority] : null,
      assignee: c.assignee,
      openedAt: c.createdAt,
      resolvedAt: c.doneAt,
      jobNumber: null,
    } as TicketCard;
  }
  return out;
}
