import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { CollectionProvider } from "@/lib/items/point";
import type { Collection, Item, ItemPhase } from "@/lib/items/shared";
import { cardRef, type BoardView } from "./shared";
import { getBoard, listBoards } from "./store";

/**
 * Your Kanban boards as collections (kanban:<id>), their cards as items (KB-<id>): the column is
 * the status — the first column "todo", a done column "done", the others "doing" (as the Lage reads it).
 */

const collectionId = (boardId: number) => `kanban:${boardId}`;

function itemsOf(b: BoardView): Item[] {
  const first = b.columns[0]?.id;
  return b.columns.flatMap((col) => {
    const phase: ItemPhase = col.done ? "done" : col.id === first ? "todo" : "doing";
    return col.cards.map(
      (c): Item => ({
        ref: cardRef(c.id),
        collectionId: collectionId(b.id),
        kind: "card",
        title: c.title,
        text: c.description,
        labels: c.labels,
        status: { name: col.name, phase },
        due: c.due,
        assignee: c.assignee,
        color: null,
        pinned: false,
        archived: false,
        parentRef: c.parentId ? cardRef(c.parentId) : null,
        href: `/kanban/${b.id}?card=${c.id}`,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      }),
    );
  });
}

export const kanbanCollections: CollectionProvider = {
  collections: () =>
    listBoards().map(
      (b): Collection => ({
        id: collectionId(b.id),
        plugin: "kanban",
        kind: "board",
        name: b.name,
        description: b.description,
        color: b.color,
        href: `/kanban/${b.id}`,
        readOnly: false,
        briefing: b.inLage,
        knowledge: false,
        items: b.cards,
      }),
    ),
  items(id) {
    const m = /^kanban:(\d+)$/.exec(id);
    if (!m || !listBoards().some((b) => b.id === Number(m[1]))) return null;
    return itemsOf(getBoard(Number(m[1])));
  },
  byRefs(refs) {
    const ids = refs.flatMap((r) => {
      const m = /^KB-(\d+)$/i.exec(r);
      return m ? [Number(m[1])] : [];
    });
    if (!ids.length) return [];
    const { kanbanCards: cards, kanbanBoards: boards } = schema;
    const rows = getDb()
      .select({ boardId: cards.boardId })
      .from(cards)
      .innerJoin(boards, eq(boards.id, cards.boardId))
      .where(and(inArray(cards.id, ids), eq(cards.archived, false), eq(boards.archived, false)))
      .all();
    const wanted = new Set(ids.map(cardRef));
    return [...new Set(rows.map((r) => r.boardId))].flatMap((b) => itemsOf(getBoard(b)).filter((it) => wanted.has(it.ref)));
  },
};
