import { getSqlite } from "@/db";
import { clip as flatClip } from "@/lib/text";
import type { Candidate } from "@/lib/rag";

/**
 * A full-text index (SQLite FTS5) over the big message tables — mails and chats, Teams — for the
 * retrieval the AI steps ask for (rag.ts): ranked by relevance (BM25), accents and umlauts folded,
 * words matched by their beginnings ("Navigat" finds "Navigation"). Built from what the syncs keep,
 * a piece at a time; a search first brings it up to date. Where the index can't be used the callers
 * fall back to scanning with LIKE. Server only.
 */

const SOURCES = {
  mails: { table: "emails", mark: "received_at", sql: "select key ref, received_at at, coalesce(from_name, '') || ' ' || subject || ' ' || preview text from emails where received_at > ? order by received_at limit ?" },
  teams: { table: "teams_messages", mark: "sent_at", sql: "select key ref, sent_at at, coalesce(sender_name, '') || ' ' || coalesce(place, '') || ' ' || text text from teams_messages where sent_at > ? order by sent_at limit ?" },
} as const;
export type IndexedSource = keyof typeof SOURCES;

function db() {
  const d = getSqlite();
  d.exec(`
    create virtual table if not exists ctx_fts using fts5(text, tokenize = 'unicode61 remove_diacritics 2');
    create table if not exists ctx_fts_map (id integer primary key autoincrement, source text not null, ref text not null, at text not null, unique (source, ref));
    create table if not exists ctx_fts_state (source text primary key, mark text not null);
  `);
  return d;
}

/** Bring the index of a source up to date (at most `limit` new rows per call). How many were added. */
export function indexSource(source: IndexedSource, limit = 20000): number {
  const d = db();
  let mark = (d.prepare("select mark from ctx_fts_state where source = ?").get(source) as { mark: string } | undefined)?.mark ?? "";
  // Rows a sync added with older times than the mark (a backfill) were missed: when the index has fallen behind, read it all again (a row is kept once).
  if (mark) {
    const have = (d.prepare("select count(*) n from ctx_fts_map where source = ?").get(source) as { n: number }).n;
    const total = (d.prepare(`select count(*) n from ${SOURCES[source].table}`).get() as { n: number }).n;
    if (have < total * 0.95) mark = "";
  }
  const rows = d.prepare(SOURCES[source].sql).all(mark, limit) as { ref: string; at: string; text: string }[];
  if (!rows.length) return 0;
  const map = d.prepare("insert or ignore into ctx_fts_map (source, ref, at) values (?, ?, ?)");
  const fts = d.prepare("insert into ctx_fts (rowid, text) values (?, ?)");
  let added = 0;
  d.transaction(() => {
    for (const r of rows) {
      const m = map.run(source, r.ref, r.at);
      if (m.changes) {
        fts.run(Number(m.lastInsertRowid), r.text);
        added++;
      }
    }
    d.prepare("insert into ctx_fts_state (source, mark) values (?, ?) on conflict(source) do update set mark = excluded.mark").run(source, rows[rows.length - 1].at);
  })();
  return added;
}

/** The FTS query for some words: each as a prefix, any of them. */
export const matchQuery = (words: string[]): string => words.map((w) => w.replace(/["*]/g, "")).filter(Boolean).map((w) => `"${w}"*`).join(" OR ");

/** The best matches (references with the time and the relevance rank, best first) for some words in a source. */
export function searchIndex(source: IndexedSource, words: string[], limit = 40): { ref: string; at: string }[] {
  const q = matchQuery(words);
  if (!q) return [];
  indexSource(source);
  return db()
    .prepare("select m.ref, m.at from ctx_fts join ctx_fts_map m on m.id = ctx_fts.rowid where ctx_fts match ? and m.source = ? order by bm25(ctx_fts) limit ?")
    .all(q, source, limit) as { ref: string; at: string }[];
}

const clip = (s: string | null | undefined, n: number) => flatClip((s ?? "").replace(/[⟦⟧]/g, ""), n);

/**
 * Candidates for the retrieval from the index — null when it can't be used (no FTS5, a failing query),
 * so the caller scans instead. The order of the index's ranking is kept in the score's decimals.
 */
export function indexedCandidates(source: IndexedSource, words: string[]): Candidate[] | null {
  try {
    const hits = searchIndex(source, words);
    if (!hits.length) return null;
    const d = getSqlite();
    const out: Candidate[] = [];
    hits.forEach((h, i) => {
      const bonus = (hits.length - i) / (2 * hits.length);
      if (source === "mails") {
        const m = d.prepare("select key, from_name, from_email, subject, preview, received_at from emails where key = ?").get(h.ref) as { key: string; from_name: string | null; from_email: string | null; subject: string; preview: string; received_at: string } | undefined;
        if (!m) return;
        const hay = `${m.subject} ${m.preview} ${m.from_name ?? ""}`.toLowerCase();
        out.push({ source: "mails", ref: `mail:${m.key}`, title: `${m.from_name ?? m.from_email ?? "?"}: ${clip(m.subject, 120)}`, text: clip(m.preview, 400), when: m.received_at.slice(0, 10), score: Math.max(1, words.filter((w) => hay.includes(w)).length) + bonus });
      } else {
        const m = d.prepare("select key, sender_name, place, text, sent_at from teams_messages where key = ?").get(h.ref) as { key: string; sender_name: string | null; place: string | null; text: string; sent_at: string } | undefined;
        if (!m) return;
        const hay = `${m.text} ${m.sender_name ?? ""} ${m.place ?? ""}`.toLowerCase();
        out.push({ source: "teams", ref: `teams:${m.key}`, title: `${m.sender_name ?? "?"}${m.place ? ` in ${m.place}` : ""}`, text: clip(m.text, 400), when: m.sent_at.slice(0, 10), score: Math.max(1, words.filter((w) => hay.includes(w)).length) + bonus });
      }
    });
    return out;
  } catch {
    return null;
  }
}
