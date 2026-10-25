import { AsyncLocalStorage } from "node:async_hooks";
import { getSqlite } from "@/db";
import { withCause } from "@/lib/cause";

/**
 * Undo for whole actions: what the AI did in an answer, what an automation did in a run, a bulk edit, a move of rows. While such an action
 * runs, the store tells this module which pages it is about to change (their state before is kept, once each) and which it makes; when the
 * action is through, that is one entry - "Undo" puts every page back as it was and sends the made ones to the trash. Kept: the last 40
 * entries of the last 30 days; an action that touches more than 500 pages is not kept (too big to hold - it says so). Server only.
 */

type Raw = Record<string, unknown> & { id: number };
type Scope = { before: Map<number, Raw>; made: Set<number> };

const scope = new AsyncLocalStorage<Scope>();
const MAX_PAGES = 500;
const MAX_ENTRIES = 40;
const KEEP_DAYS = 30;

export type UndoEntry = { id: number; at: string; label: string; actor: "you" | "ai" | "source"; pages: number; undoable: boolean; undone: boolean };

function table() {
  const sqlite = getSqlite();
  sqlite.exec("create table if not exists ws_undo (id integer primary key autoincrement, at text not null, label text not null, actor text not null, pages integer not null, data text, undone integer not null default 0)");
  return sqlite;
}

/** The store says: these pages are about to be changed (or removed) - their state now is what Undo restores. */
export function touch(...ids: number[]): void {
  const s = scope.getStore();
  if (!s) return;
  for (const id of ids) {
    if (s.before.has(id) || s.made.has(id) || s.before.size > MAX_PAGES) continue;
    const row = getSqlite().prepare("select * from ws_pages where id = ?").get(id) as Raw | undefined;
    if (row) s.before.set(id, row);
  }
}

/** The store says: this page was just made. */
export function made(id: number): void {
  scope.getStore()?.made.add(id);
}

type Actor = UndoEntry["actor"];

/**
 * `fn` runs as one action that can be undone - what it returns (a promise too) comes back as it is. A failed action may have changed things
 * before it failed: those are kept as well. Inside another such action it belongs to that one.
 */
export function journaled<T>(label: string, fn: () => T, actor: Actor = "you", onSaved?: (undoId: number | null) => void): T {
  if (scope.getStore()) return withCause(label, fn);
  const s: Scope = { before: new Map(), made: new Set() };
  const done = () => {
    save(s, label, actor);
    onSaved?.(lastSaved.get(s) ?? null);
  };
  let out: T;
  try {
    out = scope.run(s, () => withCause(label, fn));
  } catch (e) {
    done();
    throw e;
  }
  if (out && typeof (out as { then?: unknown }).then === "function") return (out as unknown as Promise<unknown>).finally(done) as T;
  done();
  return out;
}

/** The same, for an action you wait for: the entry's id comes back with the result (null: it changed nothing, was too big, or ran inside another). */
export async function undoable<T>(label: string, fn: () => Promise<T> | T, actor: Actor = "you"): Promise<{ value: T; undoId: number | null }> {
  let undoId: number | null = null;
  const value = await journaled(label, fn, actor, (id) => (undoId = id));
  return { value, undoId };
}

const lastSaved = new WeakMap<Scope, number>();

function save(s: Scope, label: string, actor: Actor): void {
  const pages = s.before.size + s.made.size;
  if (!pages) return;
  try {
    const sqlite = table();
    const big = s.before.size > MAX_PAGES || pages > MAX_PAGES;
    const r = sqlite
      .prepare("insert into ws_undo (at, label, actor, pages, data) values (?, ?, ?, ?, ?)")
      .run(new Date().toISOString(), label.slice(0, 160), actor, pages, big ? null : JSON.stringify({ rows: [...s.before.values()], made: [...s.made] }));
    lastSaved.set(s, Number(r.lastInsertRowid));
    sqlite.prepare("delete from ws_undo where at < ? or id not in (select id from ws_undo order by id desc limit ?)").run(new Date(Date.now() - KEEP_DAYS * 86400000).toISOString(), MAX_ENTRIES);
  } catch {
    // The journal never stops an action.
  }
}

export function undoEntries(limit = 40): UndoEntry[] {
  return (table().prepare("select id, at, label, actor, pages, data is not null as undoable, undone from ws_undo order by id desc limit ?").all(limit) as { id: number; at: string; label: string; actor: "you" | "ai" | "source"; pages: number; undoable: number; undone: number }[]).map((r) => ({ ...r, undoable: !!r.undoable, undone: !!r.undone }));
}

/** How many of an entry's pages were changed again since (their edit time is after the action). */
export function undoPreview(id: number): { pages: number; newerEdits: number } {
  const row = table().prepare("select at, pages, data from ws_undo where id = ?").get(id) as { at: string; pages: number; data: string | null } | undefined;
  if (!row?.data) return { pages: row?.pages ?? 0, newerEdits: 0 };
  const data = JSON.parse(row.data) as { rows: Raw[]; made: number[] };
  const ids = [...data.rows.map((r) => r.id), ...data.made];
  const after = (ids.length ? table().prepare(`select count(*) n from ws_pages where id in (${ids.map(() => "?").join(",")}) and updated_at > ?`).get(...ids, row.at) : { n: 0 }) as { n: number };
  return { pages: ids.length, newerEdits: after.n };
}

/** An action undone: its pages as they were, the ones it made in the trash. Throws when the entry can't be undone (too big, undone before). */
export async function undo(id: number): Promise<{ restored: number; trashed: number }> {
  const row = table().prepare("select data, undone from ws_undo where id = ?").get(id) as { data: string | null; undone: number } | undefined;
  if (!row) throw new Error("That change is no longer in the history.");
  if (!row.data) throw new Error("That action touched too many pages to be kept — it can't be undone.");
  if (row.undone) throw new Error("That change was undone already.");
  const data = JSON.parse(row.data) as { rows: Raw[]; made: number[] };
  const { restoreRaw } = await import("./store");
  const out = restoreRaw(data.rows, data.made);
  table().prepare("update ws_undo set undone = 1 where id = ?").run(id);
  return out;
}
