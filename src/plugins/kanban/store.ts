import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { emitChange } from "@/lib/events";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/i18n/server";
import { BOARD_COLORS, cardRef, isPriority, type BoardView, type CardView, type ColumnView, type Priority } from "./shared";

/** Kanban: your own boards, their columns and cards — in the account's database. */

const { kanbanBoards: boards, kanbanColumns: columns, kanbanCards: cards } = schema;
const now = () => new Date().toISOString();
const changed = () => emitChange("kanban");

const labelsOf = (raw: string): string[] => {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};

function toCard(r: typeof cards.$inferSelect): CardView {
  return {
    id: r.id,
    ref: cardRef(r.id),
    columnId: r.columnId,
    title: r.title,
    description: r.description,
    labels: labelsOf(r.labels),
    priority: isPriority(r.priority) ? r.priority : null,
    due: r.due,
    assignee: r.assignee,
    sort: r.sort,
    parentId: r.parentId ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    doneAt: r.doneAt,
  };
}

export function listBoards(opts: { archived?: boolean } = {}): (typeof boards.$inferSelect & { cards: number; open: number })[] {
  return getDb()
    .select({
      b: boards,
      cards: sql<number>`(select count(*) from kanban_cards c where c.board_id = "kanban_boards"."id" and c.archived = 0)`,
      open: sql<number>`(select count(*) from kanban_cards c join kanban_columns k on k.id = c.column_id where c.board_id = "kanban_boards"."id" and c.archived = 0 and k.done = 0)`,
    })
    .from(boards)
    .where(opts.archived ? undefined : eq(boards.archived, false))
    .orderBy(asc(boards.sort), asc(boards.id))
    .all()
    .map((r) => ({ ...r.b, cards: r.cards, open: r.open }));
}

export function getBoard(id: number): BoardView {
  const b = getDb().select().from(boards).where(eq(boards.id, id)).get();
  if (!b) throw new NotFoundError(t("That board doesn't exist."));
  const cols = getDb().select().from(columns).where(eq(columns.boardId, id)).orderBy(asc(columns.sort), asc(columns.id)).all();
  const all = getDb().select().from(cards).where(and(eq(cards.boardId, id), eq(cards.archived, false))).orderBy(asc(cards.sort), asc(cards.id)).all().map(toCard);
  const view: ColumnView[] = cols.map((c) => ({ id: c.id, name: c.name, sort: c.sort, wipLimit: c.wipLimit, done: c.done, cards: all.filter((x) => x.columnId === c.id) }));
  return { id: b.id, name: b.name, description: b.description, color: b.color, inLage: b.inLage, columns: view, createdAt: b.createdAt, updatedAt: b.updatedAt };
}

const name = (v: string, what: string, max = 120) => {
  const s = v.trim().slice(0, max);
  if (!s) throw new ValidationError(t("{what}: please give it a name.", { what }));
  return s;
};

/** A new board with its columns (default: Open, In progress, Done — the last one counts as done). */
export function createBoard(v: { name: string; description?: string; color?: string; columns?: string[] }): number {
  const cols = (v.columns?.map((c) => c.trim()).filter(Boolean) ?? []).slice(0, 20);
  const list = cols.length ? cols : [t("Open"), t("In progress"), t("Done")];
  return getDb().transaction((tx) => {
    const sort = (tx.select({ n: sql<number>`coalesce(max(sort), 0)` }).from(boards).get()?.n ?? 0) + 1;
    const b = tx
      .insert(boards)
      .values({ name: name(v.name, t("Board")), description: (v.description ?? "").trim().slice(0, 2000), color: (BOARD_COLORS as readonly string[]).includes(v.color ?? "") ? v.color! : "indigo", sort })
      .returning()
      .get();
    list.forEach((c, i) => tx.insert(columns).values({ boardId: b.id, name: c.slice(0, 60), sort: i, done: i === list.length - 1 && list.length > 1 }).run());
    changed();
    return b.id;
  });
}

export function updateBoard(id: number, patch: { name?: string; description?: string; color?: string; archived?: boolean; inLage?: boolean }): void {
  const set: Partial<typeof boards.$inferInsert> = { updatedAt: now() };
  if (patch.name !== undefined) set.name = name(patch.name, t("Board"));
  if (patch.description !== undefined) set.description = patch.description.trim().slice(0, 2000);
  if (patch.color !== undefined && (BOARD_COLORS as readonly string[]).includes(patch.color)) set.color = patch.color;
  if (patch.archived !== undefined) set.archived = patch.archived;
  if (patch.inLage !== undefined) set.inLage = patch.inLage;
  getDb().update(boards).set(set).where(eq(boards.id, id)).run();
  changed();
}

/** A board one place up (-1) or down (+1) in the list. */
export function moveBoard(id: number, dir: -1 | 1): void {
  const list = getDb().select().from(boards).orderBy(asc(boards.sort), asc(boards.id)).all();
  const i = list.findIndex((x) => x.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  getDb().transaction((tx) => list.forEach((x, k) => tx.update(boards).set({ sort: k }).where(eq(boards.id, x.id)).run()));
  changed();
}

export function deleteBoard(id: number): void {
  getDb().delete(boards).where(eq(boards.id, id)).run();
  changed();
}

export function addColumn(boardId: number, columnName: string): number {
  const sort = (getDb().select({ n: sql<number>`coalesce(max(sort), -1)` }).from(columns).where(eq(columns.boardId, boardId)).get()?.n ?? -1) + 1;
  const c = getDb().insert(columns).values({ boardId, name: name(columnName, t("Column"), 60), sort }).returning().get();
  changed();
  return c.id;
}

export function updateColumn(id: number, patch: { name?: string; wipLimit?: number | null; done?: boolean }): void {
  const set: Partial<typeof columns.$inferInsert> = {};
  if (patch.name !== undefined) set.name = name(patch.name, t("Column"), 60);
  if (patch.wipLimit !== undefined) set.wipLimit = patch.wipLimit && patch.wipLimit > 0 ? Math.round(patch.wipLimit) : null;
  if (patch.done !== undefined) set.done = patch.done;
  if (Object.keys(set).length) getDb().update(columns).set(set).where(eq(columns.id, id)).run();
  changed();
}

/** A column one place to the left (-1) or right (+1). */
export function moveColumn(id: number, dir: -1 | 1): void {
  const c = getDb().select().from(columns).where(eq(columns.id, id)).get();
  if (!c) throw new NotFoundError(t("That column doesn't exist."));
  const list = getDb().select().from(columns).where(eq(columns.boardId, c.boardId)).orderBy(asc(columns.sort), asc(columns.id)).all();
  const i = list.findIndex((x) => x.id === id);
  const j = i + dir;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  getDb().transaction((tx) => list.forEach((x, k) => tx.update(columns).set({ sort: k }).where(eq(columns.id, x.id)).run()));
  changed();
}

/** A column gone — only an empty one (its cards would go with it). */
export function deleteColumn(id: number): void {
  const n = getDb().select({ n: sql<number>`count(*)` }).from(cards).where(and(eq(cards.columnId, id), eq(cards.archived, false))).get()?.n ?? 0;
  if (n) throw new ValidationError(n === 1 ? t("The column still has 1 card — move it first.") : t("The column still has {n} cards — move them first.", { n }));
  getDb().delete(columns).where(eq(columns.id, id)).run();
  changed();
}

const isDone = (columnId: number) => !!getDb().select({ done: columns.done }).from(columns).where(eq(columns.id, columnId)).get()?.done;

export function createCard(columnId: number, title: string): CardView {
  const col = getDb().select().from(columns).where(eq(columns.id, columnId)).get();
  if (!col) throw new NotFoundError(t("That column doesn't exist."));
  const sort = (getDb().select({ n: sql<number>`coalesce(max(sort), 0)` }).from(cards).where(eq(cards.columnId, columnId)).get()?.n ?? 0) + 1;
  const r = getDb()
    .insert(cards)
    .values({ boardId: col.boardId, columnId, title: name(title, t("Card"), 300), sort, doneAt: col.done ? now() : null })
    .returning()
    .get();
  getDb().update(boards).set({ updatedAt: now() }).where(eq(boards.id, col.boardId)).run();
  changed();
  return toCard(r);
}

/**
 * A subtask of a card: a card of its own on the same board — in the parent's column to begin with,
 * moved to any other column after — linked to the parent (one level: a subtask has no subtasks).
 */
export function createSubtask(parentId: number, title: string): CardView {
  const db = getDb();
  const parent = db.select().from(cards).where(eq(cards.id, parentId)).get();
  if (!parent) throw new NotFoundError("Die Karte gibt es nicht.");
  if (parent.parentId) throw new ValidationError("Eine Unteraufgabe kann keine eigenen Unteraufgaben haben.");
  const card = createCard(parent.columnId, title);
  db.update(cards).set({ parentId }).where(eq(cards.id, card.id)).run();
  return { ...card, parentId };
}

/** A subtask made a card of its own again. */
export function detachSubtask(id: number): void {
  getDb().update(cards).set({ parentId: null, updatedAt: now() }).where(eq(cards.id, id)).run();
  changed();
}

export function updateCard(id: number, patch: { title?: string; description?: string; labels?: string[]; priority?: Priority | null; due?: string | null; assignee?: string | null }): CardView {
  const set: Partial<typeof cards.$inferInsert> = { updatedAt: now() };
  if (patch.title !== undefined) set.title = name(patch.title, t("Card"), 300);
  if (patch.description !== undefined) set.description = patch.description.slice(0, 20000);
  if (patch.labels !== undefined) set.labels = JSON.stringify([...new Set(patch.labels.map((l) => l.trim()).filter(Boolean))].slice(0, 12));
  if (patch.priority !== undefined) set.priority = patch.priority && isPriority(patch.priority) ? patch.priority : null;
  if (patch.assignee !== undefined) set.assignee = patch.assignee?.trim().slice(0, 80) || null;
  if (patch.due !== undefined) {
    if (patch.due && !/^\d{4}-\d{2}-\d{2}$/.test(patch.due)) throw new ValidationError(t("Due: a date (YYYY-MM-DD)."));
    set.due = patch.due || null;
  }
  const r = getDb().update(cards).set(set).where(eq(cards.id, id)).returning().get();
  if (!r) throw new NotFoundError(t("That card doesn't exist."));
  changed();
  return toCard(r);
}

/**
 * A card moved: into a column, before the card `before` (none: at the end). Into a "done" column
 * it's done (since now); out of one, open again.
 */
export function moveCard(id: number, columnId: number, before: number | null): void {
  const db = getDb();
  const card = db.select().from(cards).where(eq(cards.id, id)).get();
  if (!card) throw new NotFoundError(t("That card doesn't exist."));
  const list = db.select().from(cards).where(and(eq(cards.columnId, columnId), eq(cards.archived, false))).orderBy(asc(cards.sort), asc(cards.id)).all().filter((c) => c.id !== id);
  const at = before ? list.findIndex((c) => c.id === before) : -1;
  const prev = at > 0 ? list[at - 1].sort : at === 0 ? list[0].sort - 2 : (list[list.length - 1]?.sort ?? 0);
  const next = at >= 0 ? list[at].sort : prev + 2;
  const done = isDone(columnId);
  db.update(cards)
    .set({ columnId, sort: (prev + next) / 2, updatedAt: now(), doneAt: done ? (card.doneAt ?? now()) : null })
    .where(eq(cards.id, id))
    .run();
  changed();
}

/** A card to another board of yours — into its first column, at the end. It keeps its ref (KB-…), so its todos and Lage go with it. */
export function moveCardToBoard(id: number, boardId: number, withSubtasks = false): void {
  const db = getDb();
  const card = db.select().from(cards).where(eq(cards.id, id)).get();
  if (!card) throw new NotFoundError("Die Karte gibt es nicht.");
  if (card.boardId === boardId) return;
  const target = db.select().from(boards).where(eq(boards.id, boardId)).get();
  if (!target || target.archived) throw new NotFoundError("Das Board gibt es nicht.");
  const col = db.select().from(columns).where(eq(columns.boardId, boardId)).orderBy(asc(columns.sort), asc(columns.id)).get();
  if (!col) throw new ValidationError(`„${target.name}“ hat keine Spalte.`);
  const sort = (db.select({ n: sql<number>`coalesce(max(sort), 0)` }).from(cards).where(eq(cards.columnId, col.id)).get()?.n ?? 0) + 1;
  // Links stay within a board: a subtask leaves its parent; a parent's subtasks either come along (each into the first column, after the parent, still linked to it) or stay behind as cards of their own.
  const kids = withSubtasks ? db.select().from(cards).where(eq(cards.parentId, id)).orderBy(asc(cards.sort), asc(cards.id)).all() : [];
  if (!withSubtasks) db.update(cards).set({ parentId: null }).where(eq(cards.parentId, id)).run();
  db.update(cards)
    .set({ boardId, columnId: col.id, sort, parentId: null, updatedAt: now(), doneAt: col.done ? (card.doneAt ?? now()) : null })
    .where(eq(cards.id, id))
    .run();
  kids.forEach((kid, i) =>
    db
      .update(cards)
      .set({ boardId, columnId: col.id, sort: sort + 1 + i, updatedAt: now(), doneAt: col.done ? (kid.doneAt ?? now()) : null })
      .where(eq(cards.id, kid.id))
      .run(),
  );
  db.update(boards).set({ updatedAt: now() }).where(sql`${boards.id} in (${boardId}, ${card.boardId})`).run();
  changed();
}

export function archiveCard(id: number): void {
  getDb().update(cards).set({ archived: true, updatedAt: now() }).where(eq(cards.id, id)).run();
  changed();
}

/** A card as it is stored, with the subtasks it has — to put it back (restoreCard) after a delete. */
export type CardSnapshot = typeof cards.$inferSelect & { kidIds: number[] };

export function snapshotCard(id: number): CardSnapshot {
  const row = getDb().select().from(cards).where(eq(cards.id, id)).get();
  if (!row) throw new NotFoundError(t("That card doesn't exist."));
  const kidIds = getDb().select({ id: cards.id }).from(cards).where(eq(cards.parentId, id)).all().map((k) => k.id);
  return { ...row, kidIds };
}

/**
 * A deleted card put back — same id (so its KB-ref, todos and Lage links hold), column, position,
 * labels, assignee, due, priority, parent and subtasks. Its column must still be there.
 */
export function restoreCard(snap: CardSnapshot): CardView {
  const db = getDb();
  const { kidIds, ...row } = snap;
  if (db.select().from(cards).where(eq(cards.id, row.id)).get()) throw new ValidationError(t("That card exists already."));
  const col = db.select().from(columns).where(eq(columns.id, row.columnId)).get();
  if (!col) throw new NotFoundError(t("That column doesn't exist."));
  const parentOk = row.parentId !== null && !!db.select().from(cards).where(eq(cards.id, row.parentId)).get();
  const r = db
    .insert(cards)
    .values({ ...row, boardId: col.boardId, parentId: parentOk ? row.parentId : null, archived: false, updatedAt: now() })
    .returning()
    .get();
  kidIds.forEach((k) => db.update(cards).set({ parentId: r.id }).where(and(eq(cards.id, k), isNull(cards.parentId))).run());
  changed();
  return toCard(r);
}

export function unarchiveCard(id: number): void {
  getDb().update(cards).set({ archived: false, updatedAt: now() }).where(eq(cards.id, id)).run();
  changed();
}

export function deleteCard(id: number): void {
  // Its subtasks become cards of their own.
  getDb().update(cards).set({ parentId: null }).where(eq(cards.parentId, id)).run();
  getDb().delete(cards).where(eq(cards.id, id)).run();
  changed();
}

/**
 * A Lage action on a card (its suggestion, clicked): a transition moves it to the column named; a
 * comment goes into its description as a dated note. What was done, in words.
 */
export function kanbanCardAction(id: number, action: { type: string; to?: string; comment?: string; label: string }): string {
  const card = getDb().select().from(cards).where(eq(cards.id, id)).get();
  if (!card) throw new NotFoundError(t("That card doesn't exist (any more)."));
  if (action.type === "transition") {
    const want = (action.to ?? "").trim().toLowerCase();
    const cols = getDb().select().from(columns).where(eq(columns.boardId, card.boardId)).all();
    const hit = cols.find((c) => c.name.trim().toLowerCase() === want) ?? cols.find((c) => !!want && c.name.toLowerCase().includes(want));
    if (!hit) throw new ValidationError(t("No column “{name}” — there are: {columns}.", { name: action.to, columns: cols.map((c) => c.name).join(", ") }));
    moveCard(id, hit.id, null);
    return `→ ${hit.name}`;
  }
  if (action.type === "comment" && action.comment?.trim()) {
    const stamp = formatDate(new Date(), { weekday: false, year: true });
    const note = `— ${stamp}: ${action.comment.trim()}`;
    updateCard(id, { description: card.description ? `${card.description}\n\n${note}` : note });
    return t("Note on the card");
  }
  throw new ValidationError(t("That doesn't work on a Kanban card (no assignment)."));
}
