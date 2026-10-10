import { getSqlite } from "@/db";
import { getPref, setPref } from "@/lib/prefs";

/**
 * Your Google Keep notes as Zeff keeps them (Google Keep plugin): each note or list with its text,
 * labels, pinned / archived, colour, when it was made and last edited, and its link in Keep. The
 * Keep sync fills it (the account's automation Chrome); the Keep app, the knowledge and agents read
 * it. Its own table, made when it's first needed (the plugin may never be installed).
 */

export type KeepNote = {
  id: string;
  kind: "note" | "list";
  title: string;
  text: string;
  labels: string[];
  color: string | null;
  pinned: boolean;
  archived: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  url: string;
};

type Row = { id: string; kind: string; title: string; text: string; labels: string; color: string | null; pinned: number; archived: number; created_at: string | null; updated_at: string | null; url: string };

function db() {
  const d = getSqlite();
  d.exec(
    "create table if not exists keep_notes (id text primary key, kind text not null default 'note', title text not null default '', text text not null default '', labels text not null default '[]', color text, pinned integer not null default 0, archived integer not null default 0, created_at text, updated_at text, url text not null default '', synced_at text not null)",
  );
  return d;
}

const toNote = (r: Row): KeepNote => {
  let labels: string[] = [];
  try {
    labels = JSON.parse(r.labels) as string[];
  } catch {
    // none
  }
  return { id: r.id, kind: r.kind === "list" ? "list" : "note", title: r.title, text: r.text, labels, color: r.color, pinned: !!r.pinned, archived: !!r.archived, createdAt: r.created_at, updatedAt: r.updated_at, url: r.url };
};

/**
 * Keep what the sync read: new and changed notes in, and — when Keep gave all of them (`full`) —
 * the ones gone from Keep (deleted, in the trash) out.
 */
export function saveKeepNotes(notes: KeepNote[], full: boolean): { added: number; changed: number; removed: number; total: number } {
  const d = db();
  const known = new Map((d.prepare("select id, updated_at, title, text, labels, pinned, archived from keep_notes").all() as Row[]).map((r) => [r.id, r]));
  const now = new Date().toISOString();
  const upsert = d.prepare(
    "insert into keep_notes (id, kind, title, text, labels, color, pinned, archived, created_at, updated_at, url, synced_at) values (@id, @kind, @title, @text, @labels, @color, @pinned, @archived, @createdAt, @updatedAt, @url, @now) " +
      "on conflict(id) do update set kind = excluded.kind, title = excluded.title, text = excluded.text, labels = excluded.labels, color = excluded.color, pinned = excluded.pinned, archived = excluded.archived, created_at = excluded.created_at, updated_at = excluded.updated_at, url = excluded.url, synced_at = excluded.synced_at",
  );
  let added = 0;
  let changed = 0;
  let removed = 0;
  d.transaction(() => {
    for (const n of notes) {
      const labels = JSON.stringify(n.labels ?? []);
      const k = known.get(n.id);
      if (!k) added++;
      else if (k.updated_at !== n.updatedAt || k.title !== n.title || k.text !== n.text || k.labels !== labels || !!k.pinned !== n.pinned || !!k.archived !== n.archived) changed++;
      upsert.run({ ...n, labels, pinned: n.pinned ? 1 : 0, archived: n.archived ? 1 : 0, now });
    }
    if (full) {
      const seen = new Set(notes.map((n) => n.id));
      const del = d.prepare("delete from keep_notes where id = ?");
      for (const id of known.keys()) if (!seen.has(id)) removed += del.run(id).changes;
    }
  })();
  const total = (d.prepare("select count(*) n from keep_notes").get() as { n: number }).n;
  return { added, changed, removed, total };
}

/** The notes — pinned first, then the latest edited; a search through title, text and labels. */
export function listKeepNotes({ q = "", label = "", archived = false, limit = 2000 }: { q?: string; label?: string; archived?: boolean; limit?: number } = {}): KeepNote[] {
  const like = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const where = ["archived = ?"];
  const args: unknown[] = [archived ? 1 : 0];
  if (q) {
    where.push("(title like ? escape '\\' or text like ? escape '\\' or labels like ? escape '\\')");
    args.push(like(q), like(q), like(q));
  }
  if (label) {
    where.push("labels like ? escape '\\'");
    args.push(like(JSON.stringify(label)));
  }
  const sql = `select * from keep_notes where ${where.join(" and ")} order by pinned desc, coalesce(updated_at, created_at) desc limit ?`;
  return (db().prepare(sql).all(...args, limit) as Row[]).map(toNote);
}

/** All notes, archived ones too (the knowledge export). */
export const allKeepNotes = (): KeepNote[] => (db().prepare("select * from keep_notes order by coalesce(updated_at, created_at) desc").all() as Row[]).map(toNote);

/** The labels in use, most used first. */
export function keepLabels(): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const n of listKeepNotes({ limit: 100000 })) for (const l of n.labels) counts.set(l, (counts.get(l) ?? 0) + 1);
  return [...counts].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export const keepCount = (): number => (db().prepare("select count(*) n from keep_notes").get() as { n: number }).n;

// ---------------------------------------------------------------------------
// Settings: which Google account's Keep — and how the last sync went
// ---------------------------------------------------------------------------

const KEY = "plugin:keep";

/** The Google account read (its number in the automation Chrome, u/<n>, or its address) — by default the first signed in. */
export type KeepSettings = { account: string };

export const keepSettings = (): KeepSettings => ({ account: "0", ...getPref<Partial<KeepSettings>>(KEY, {}) });
export const setKeepSettings = (s: Partial<KeepSettings>) => setPref(KEY, { ...keepSettings(), ...s });
