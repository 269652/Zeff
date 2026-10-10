import { getSqlite } from "@/db";
import { emitChange } from "@/lib/events";
import { allKeepNotes, type KeepNote } from "./store";
import { isKeepColor } from "./colors";
import type { KeepNoteBrief } from "./shared";

/**
 * Your own Keep boards (Google Keep plugin): note boards in Zeff — "Privat", "Ideen", "Einkauf" —
 * with notes like Keep's (title, text, checklists as "- [ ]" lines, colour, labels, pinned,
 * archived). They go into the Lage as context, become todos (Notiz-Durchsicht) and are linked to
 * todos (Notiz-Zuordnung) — like Google Keep's notes, which come in through the Keep sync.
 *
 * A note is named by a ref everywhere (todos' refs, links): "keep:<Google's id>" or "keep:n<id>"
 * for one of yours. Its own tables, made when first needed (the plugin may never be installed).
 */

export type KeepBoard = { id: number; name: string; description: string; color: string; sort: number; archived: boolean; inLage: boolean; inKnowledge: boolean; notes: number };

/** A note wherever it lives — Google Keep's or one of your boards'. */
export type NoteView = KeepNote & { ref: string; source: "google" | "own"; boardId: number | null; boardName: string | null };

type BoardRow = { id: number; name: string; description: string; color: string; sort: number; archived: number; in_lage: number; in_knowledge: number; notes?: number };
type OwnRow = { id: number; board_id: number; title: string; text: string; labels: string; color: string | null; pinned: number; archived: number; created_at: string; updated_at: string };

function db() {
  const d = getSqlite();
  d.exec(`
    create table if not exists keep_boards (id integer primary key autoincrement, name text not null, description text not null default '', color text not null default 'amber', sort integer not null default 0, archived integer not null default 0, in_lage integer not null default 1, created_at text not null);
    create table if not exists keep_own_notes (id integer primary key autoincrement, board_id integer not null references keep_boards(id) on delete cascade, title text not null default '', text text not null default '', labels text not null default '[]', color text, pinned integer not null default 0, archived integer not null default 0, created_at text not null, updated_at text not null);
    create index if not exists keep_own_notes_board on keep_own_notes (board_id);
  `);
  // Later columns: a board's notes in the knowledge (on unless you turn it off).
  if (!(d.prepare("pragma table_info(keep_boards)").all() as { name: string }[]).some((c) => c.name === "in_knowledge")) d.exec("alter table keep_boards add column in_knowledge integer not null default 1");
  return d;
}

const parseLabels = (s: string): string[] => {
  try {
    const v = JSON.parse(s) as unknown;
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};
const toBoard = (r: BoardRow): KeepBoard => ({ id: r.id, name: r.name, description: r.description, color: r.color, sort: r.sort, archived: !!r.archived, inLage: !!r.in_lage, inKnowledge: !!r.in_knowledge, notes: r.notes ?? 0 });
const ownRef = (id: number) => `keep:n${id}`;
const toOwn = (r: OwnRow, boardName: string | null): NoteView => ({
  id: `n${r.id}`,
  kind: "note",
  title: r.title,
  text: r.text,
  labels: parseLabels(r.labels),
  color: r.color,
  pinned: !!r.pinned,
  archived: !!r.archived,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  url: `/keep/${r.board_id}#note-${r.id}`,
  ref: ownRef(r.id),
  source: "own",
  boardId: r.board_id,
  boardName,
});
const changed = () => emitChange("todos");

// ---------------------------------------------------------------------------
// Boards
// ---------------------------------------------------------------------------

export function listKeepBoards({ archived = false }: { archived?: boolean } = {}): KeepBoard[] {
  const rows = db()
    .prepare(`select b.*, (select count(*) from keep_own_notes n where n.board_id = b.id and n.archived = 0) notes from keep_boards b ${archived ? "" : "where b.archived = 0"} order by b.archived, b.sort, b.id`)
    .all() as BoardRow[];
  return rows.map(toBoard);
}

export const keepBoard = (id: number): KeepBoard | null => {
  const r = db().prepare("select b.*, (select count(*) from keep_own_notes n where n.board_id = b.id and n.archived = 0) notes from keep_boards b where b.id = ?").get(id) as BoardRow | undefined;
  return r ? toBoard(r) : null;
};

export function createKeepBoard(v: { name: string; description?: string; color?: string }): number {
  const name = v.name.trim().slice(0, 80);
  if (!name) throw new Error("Ein Name, bitte.");
  const d = db();
  const sort = ((d.prepare("select max(sort) m from keep_boards").get() as { m: number | null }).m ?? 0) + 1;
  const r = d.prepare("insert into keep_boards (name, description, color, sort, created_at) values (?, ?, ?, ?, ?)").run(name, (v.description ?? "").trim().slice(0, 300), v.color?.trim() || "amber", sort, new Date().toISOString());
  changed();
  return Number(r.lastInsertRowid);
}

export function updateKeepBoard(id: number, patch: { name?: string; description?: string; color?: string; archived?: boolean; inLage?: boolean; inKnowledge?: boolean }): void {
  const sets: string[] = [];
  const args: unknown[] = [];
  const set = (col: string, v: unknown) => {
    sets.push(col);
    args.push(v);
  };
  if (patch.name !== undefined) {
    if (!patch.name.trim()) throw new Error("Ein Name, bitte.");
    sets.push("name = ?");
    args.push(patch.name.trim().slice(0, 80));
  }
  if (patch.description !== undefined) set("description = ?", patch.description.trim().slice(0, 300));
  if (patch.color) set("color = ?", patch.color);
  if (patch.archived !== undefined) set("archived = ?", patch.archived ? 1 : 0);
  if (patch.inLage !== undefined) set("in_lage = ?", patch.inLage ? 1 : 0);
  if (patch.inKnowledge !== undefined) set("in_knowledge = ?", patch.inKnowledge ? 1 : 0);
  if (!sets.length) return;
  db().prepare(`update keep_boards set ${sets.join(", ")} where id = ?`).run(...args, id);
  changed();
}

export function moveKeepBoard(id: number, dir: -1 | 1): void {
  const boards = listKeepBoards({ archived: true }).filter((b) => !b.archived);
  const i = boards.findIndex((b) => b.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= boards.length) return;
  [boards[i], boards[j]] = [boards[j], boards[i]];
  const d = db();
  const set = d.prepare("update keep_boards set sort = ? where id = ?");
  d.transaction(() => boards.forEach((b, k) => set.run(k + 1, b.id)))();
}

export function deleteKeepBoard(id: number): void {
  const d = db();
  d.transaction(() => {
    d.prepare("delete from keep_own_notes where board_id = ?").run(id);
    d.prepare("delete from keep_boards where id = ?").run(id);
  })();
  changed();
}

// ---------------------------------------------------------------------------
// Your notes
// ---------------------------------------------------------------------------

/** A board's notes — pinned first, then the latest edited; a search through title, text and labels. */
export function listOwnNotes(boardId: number, { q = "", archived = false }: { q?: string; archived?: boolean } = {}): NoteView[] {
  const board = keepBoard(boardId);
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = db()
    .prepare(`select * from keep_own_notes where board_id = ? and archived = ? ${q ? "and (title like ? escape '\\' or text like ? escape '\\' or labels like ? escape '\\')" : ""} order by pinned desc, updated_at desc`)
    .all(...[boardId, archived ? 1 : 0, ...(q ? [like, like, like] : [])]) as OwnRow[];
  return rows.map((r) => toOwn(r, board?.name ?? null));
}

/** Your notes on the boards that go into the knowledge (archived notes too — as Google Keep's do; not those of archived boards). */
export function knowledgeOwnNotes(): NoteView[] {
  const rows = db()
    .prepare("select n.*, b.name board_name from keep_own_notes n join keep_boards b on b.id = n.board_id where b.archived = 0 and b.in_knowledge = 1 order by n.updated_at desc")
    .all() as (OwnRow & { board_name: string })[];
  return rows.map((r) => toOwn(r, r.board_name));
}

/** All your notes on the boards in the Lage (not archived) — the Lage's and the Durchsicht's. */
export function lageOwnNotes(): NoteView[] {
  const rows = db()
    .prepare("select n.*, b.name board_name from keep_own_notes n join keep_boards b on b.id = n.board_id where n.archived = 0 and b.archived = 0 and b.in_lage = 1 order by n.updated_at desc")
    .all() as (OwnRow & { board_name: string })[];
  return rows.map((r) => toOwn(r, r.board_name));
}

function cleanNote(v: { title?: string; text?: string; color?: string | null; labels?: string[] }) {
  return {
    ...(v.title !== undefined ? { title: v.title.trim().slice(0, 300) } : {}),
    ...(v.text !== undefined ? { text: v.text.replace(/\r/g, "").slice(0, 20000) } : {}),
    ...(v.color !== undefined ? { color: v.color && isKeepColor(v.color) ? v.color : null } : {}),
    ...(v.labels !== undefined ? { labels: JSON.stringify([...new Set(v.labels.map((l) => l.trim()).filter(Boolean))].slice(0, 20)) } : {}),
  };
}

export function createOwnNote(boardId: number, v: { title?: string; text?: string; color?: string | null; labels?: string[] }): NoteView {
  if (!keepBoard(boardId)) throw new Error("Das Board gibt es nicht.");
  const c = cleanNote(v);
  if (!c.title && !c.text?.trim()) throw new Error("Eine leere Notiz — ein Titel oder Text, bitte.");
  const now = new Date().toISOString();
  const r = db()
    .prepare("insert into keep_own_notes (board_id, title, text, labels, color, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)")
    .run(boardId, c.title ?? "", c.text ?? "", c.labels ?? "[]", c.color ?? null, now, now);
  changed();
  return ownNote(Number(r.lastInsertRowid))!;
}

export function ownNote(id: number): NoteView | null {
  const r = db().prepare("select n.*, b.name board_name from keep_own_notes n left join keep_boards b on b.id = n.board_id where n.id = ?").get(id) as (OwnRow & { board_name: string | null }) | undefined;
  return r ? toOwn(r, r.board_name) : null;
}

export function updateOwnNote(id: number, patch: { title?: string; text?: string; color?: string | null; labels?: string[]; pinned?: boolean; archived?: boolean; boardId?: number }): void {
  const c = cleanNote(patch);
  const sets: string[] = [];
  const args: unknown[] = [];
  const set = (col: string, v: unknown) => {
    sets.push(col);
    args.push(v);
  };
  for (const [k, v] of Object.entries(c)) set(`${k} = ?`, v);
  if (patch.pinned !== undefined) set("pinned = ?", patch.pinned ? 1 : 0);
  if (patch.archived !== undefined) set("archived = ?", patch.archived ? 1 : 0);
  if (patch.boardId !== undefined) {
    if (!keepBoard(patch.boardId)) throw new Error("Das Board gibt es nicht.");
    sets.push("board_id = ?");
    args.push(patch.boardId);
  }
  if (!sets.length) return;
  // What you wrote changed: a new edit time (so the Durchsicht reads it again); pinning or archiving alone: not.
  if (c.title !== undefined || c.text !== undefined || c.labels !== undefined) set("updated_at = ?", new Date().toISOString());
  db().prepare(`update keep_own_notes set ${sets.join(", ")} where id = ?`).run(...args, id);
  changed();
}

export function deleteOwnNote(id: number): void {
  db().prepare("delete from keep_own_notes where id = ?").run(id);
  changed();
}

// ---------------------------------------------------------------------------
// Notes by ref — Google Keep's and yours
// ---------------------------------------------------------------------------

const googleView = (n: KeepNote): NoteView => ({ ...n, ref: `keep:${n.id}`, source: "google", boardId: null, boardName: null });

/** Notes by their refs ("keep:…"), those still there. */
export function notesByRefs(refs: string[]): NoteView[] {
  const wanted = [...new Set(refs.filter((r) => r.startsWith("keep:")))];
  if (!wanted.length) return [];
  const out = new Map<string, NoteView>();
  const own = wanted.map((r) => /^keep:n(\d+)$/.exec(r)?.[1]).filter(Boolean).map(Number);
  for (const id of own) {
    const n = ownNote(id);
    if (n) out.set(n.ref, n);
  }
  if (wanted.length > own.length) for (const n of allKeepNotes()) if (wanted.includes(`keep:${n.id}`)) out.set(`keep:${n.id}`, googleView(n));
  return wanted.flatMap((r) => (out.has(r) ? [out.get(r)!] : []));
}

/** Every note the Lage may read: your boards in the Lage, and Google Keep's (not archived). */
export function lageNotes(): NoteView[] {
  return [...lageOwnNotes(), ...allKeepNotes().filter((n) => !n.archived).map(googleView)];
}

/** A note as a todo's source (client-safe brief). */
export const noteBrief = (n: NoteView): KeepNoteBrief => ({
  ref: n.ref,
  title: n.title,
  text: n.text,
  labels: n.labels,
  color: n.color,
  url: n.url,
  where: n.source === "google" ? "Google Keep" : (n.boardName ?? "Keep"),
  updatedAt: n.updatedAt ?? n.createdAt,
  archived: n.archived,
});

/** Notes by their refs, as briefs (for todos' sources). */
export const noteBriefsByRefs = (refs: string[]): Map<string, KeepNoteBrief> => new Map(notesByRefs(refs).map((n) => [n.ref, noteBrief(n)]));
