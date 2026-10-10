import { and, asc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { emitChange } from "@/lib/events";
import { NotFoundError, ValidationError } from "@/lib/errors";
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
  if (!b) throw new NotFoundError("Das Board gibt es nicht.");
  const cols = getDb().select().from(columns).where(eq(columns.boardId, id)).orderBy(asc(columns.sort), asc(columns.id)).all();
  const all = getDb().select().from(cards).where(and(eq(cards.boardId, id), eq(cards.archived, false))).orderBy(asc(cards.sort), asc(cards.id)).all().map(toCard);
  const view: ColumnView[] = cols.map((c) => ({ id: c.id, name: c.name, sort: c.sort, wipLimit: c.wipLimit, done: c.done, cards: all.filter((x) => x.columnId === c.id) }));
  return { id: b.id, name: b.name, description: b.description, color: b.color, inLage: b.inLage, columns: view, createdAt: b.createdAt, updatedAt: b.updatedAt };
}

const name = (v: string, what: string, max = 120) => {
  const t = v.trim().slice(0, max);
  if (!t) throw new ValidationError(`${what}: bitte einen Namen.`);
  return t;
};

/** A new board with its columns (default: Offen, In Arbeit, Erledigt — the last one counts as done). */
export function createBoard(v: { name: string; description?: string; color?: string; columns?: string[] }): number {
  const cols = (v.columns?.map((c) => c.trim()).filter(Boolean) ?? []).slice(0, 20);
  const list = cols.length ? cols : ["Offen", "In Arbeit", "Erledigt"];
  return getDb().transaction((tx) => {
    const sort = (tx.select({ n: sql<number>`coalesce(max(sort), 0)` }).from(boards).get()?.n ?? 0) + 1;
    const b = tx
      .insert(boards)
      .values({ name: name(v.name, "Board"), description: (v.description ?? "").trim().slice(0, 2000), color: (BOARD_COLORS as readonly string[]).includes(v.color ?? "") ? v.color! : "indigo", sort })
      .returning()
      .get();
    list.forEach((c, i) => tx.insert(columns).values({ boardId: b.id, name: c.slice(0, 60), sort: i, done: i === list.length - 1 && list.length > 1 }).run());
    changed();
    return b.id;
  });
}

export function updateBoard(id: number, patch: { name?: string; description?: string; color?: string; archived?: boolean; inLage?: boolean }): void {
  const set: Partial<typeof boards.$inferInsert> = { updatedAt: now() };
  if (patch.name !== undefined) set.name = name(patch.name, "Board");
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
  const c = getDb().insert(columns).values({ boardId, name: name(columnName, "Spalte", 60), sort }).returning().get();
  changed();
  return c.id;
}

export function updateColumn(id: number, patch: { name?: string; wipLimit?: number | null; done?: boolean }): void {
  const set: Partial<typeof columns.$inferInsert> = {};
  if (patch.name !== undefined) set.name = name(patch.name, "Spalte", 60);
  if (patch.wipLimit !== undefined) set.wipLimit = patch.wipLimit && patch.wipLimit > 0 ? Math.round(patch.wipLimit) : null;
  if (patch.done !== undefined) set.done = patch.done;
  if (Object.keys(set).length) getDb().update(columns).set(set).where(eq(columns.id, id)).run();
  changed();
}

/** A column one place to the left (-1) or right (+1). */
export function moveColumn(id: number, dir: -1 | 1): void {
  const c = getDb().select().from(columns).where(eq(columns.id, id)).get();
  if (!c) throw new NotFoundError("Die Spalte gibt es nicht.");
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
  if (n) throw new ValidationError(`Die Spalte hat noch ${n} Karte${n === 1 ? "" : "n"} — erst verschieben.`);
  getDb().delete(columns).where(eq(columns.id, id)).run();
  changed();
}

const isDone = (columnId: number) => !!getDb().select({ done: columns.done }).from(columns).where(eq(columns.id, columnId)).get()?.done;

export function createCard(columnId: number, title: string): CardView {
  const col = getDb().select().from(columns).where(eq(columns.id, columnId)).get();
  if (!col) throw new NotFoundError("Die Spalte gibt es nicht.");
  const sort = (getDb().select({ n: sql<number>`coalesce(max(sort), 0)` }).from(cards).where(eq(cards.columnId, columnId)).get()?.n ?? 0) + 1;
  const r = getDb()
    .insert(cards)
    .values({ boardId: col.boardId, columnId, title: name(title, "Karte", 300), sort, doneAt: col.done ? now() : null })
    .returning()
    .get();
  getDb().update(boards).set({ updatedAt: now() }).where(eq(boards.id, col.boardId)).run();
  changed();
  return toCard(r);
}

export function updateCard(id: number, patch: { title?: string; description?: string; labels?: string[]; priority?: Priority | null; due?: string | null; assignee?: string | null }): CardView {
  const set: Partial<typeof cards.$inferInsert> = { updatedAt: now() };
  if (patch.title !== undefined) set.title = name(patch.title, "Karte", 300);
  if (patch.description !== undefined) set.description = patch.description.slice(0, 20000);
  if (patch.labels !== undefined) set.labels = JSON.stringify([...new Set(patch.labels.map((l) => l.trim()).filter(Boolean))].slice(0, 12));
  if (patch.priority !== undefined) set.priority = patch.priority && isPriority(patch.priority) ? patch.priority : null;
  if (patch.assignee !== undefined) set.assignee = patch.assignee?.trim().slice(0, 80) || null;
  if (patch.due !== undefined) {
    if (patch.due && !/^\d{4}-\d{2}-\d{2}$/.test(patch.due)) throw new ValidationError("Fällig: ein Datum (JJJJ-MM-TT).");
    set.due = patch.due || null;
  }
  const r = getDb().update(cards).set(set).where(eq(cards.id, id)).returning().get();
  if (!r) throw new NotFoundError("Die Karte gibt es nicht.");
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
  if (!card) throw new NotFoundError("Die Karte gibt es nicht.");
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

export function archiveCard(id: number): void {
  getDb().update(cards).set({ archived: true, updatedAt: now() }).where(eq(cards.id, id)).run();
  changed();
}

export function deleteCard(id: number): void {
  getDb().delete(cards).where(eq(cards.id, id)).run();
  changed();
}

/**
 * A Lage action on a card (its suggestion, clicked): a transition moves it to the column named; a
 * comment goes into its description as a dated note. What was done, in words.
 */
export function kanbanCardAction(id: number, action: { type: string; to?: string; comment?: string; label: string }): string {
  const card = getDb().select().from(cards).where(eq(cards.id, id)).get();
  if (!card) throw new NotFoundError("Die Karte gibt es nicht (mehr).");
  if (action.type === "transition") {
    const want = (action.to ?? "").trim().toLowerCase();
    const cols = getDb().select().from(columns).where(eq(columns.boardId, card.boardId)).all();
    const hit = cols.find((c) => c.name.trim().toLowerCase() === want) ?? cols.find((c) => !!want && c.name.toLowerCase().includes(want));
    if (!hit) throw new ValidationError(`Keine Spalte „${action.to}“ — es gibt: ${cols.map((c) => c.name).join(", ")}.`);
    moveCard(id, hit.id, null);
    return `→ ${hit.name}`;
  }
  if (action.type === "comment" && action.comment?.trim()) {
    const stamp = new Date().toLocaleDateString("de-DE");
    const note = `— ${stamp}: ${action.comment.trim()}`;
    updateCard(id, { description: card.description ? `${card.description}\n\n${note}` : note });
    return "Notiz an der Karte";
  }
  throw new ValidationError("Das geht bei einer Kanban-Karte nicht (keine Zuweisung).");
}
