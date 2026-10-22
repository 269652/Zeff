/**
 * The timeline (the Timeline plugin): one event log of everything that happened, across the sources — a mail came, a chat message,
 * a ticket was opened or moved to Done, a comment, an appointment, time booked, a todo made or done, a Workspace row added or changed,
 * a bank transfer, a document. Each event is small (a title, a short summary, a link to where it is, the entities it concerns as refs:
 * "person:12", "ticket:PROJ-7", "page:31" …); the source tables stay the truth. Written by the indexer (indexer.ts) — once per
 * (source, source_ref), so running it again changes nothing — and read by entity ("what happened with X?"), by time, and grouped by
 * entity since a date ("what changed since I last looked?"). Its own tables, made on first use. Server only.
 */
import { getSqlite } from "@/db";

export type TimelineEvent = {
  id: number;
  /** When it happened (ISO, UTC). */
  at: string;
  /** What it is: "mail", "message", "ticket.created", "ticket.status", "comment", "todo.done", "row.changed" … (filtered by prefix: "todo"). */
  kind: string;
  /** Where it came from: mail, whatsapp, signal, teams, jira, gitlab, calendar, time, todos, workspace, bank, documents. */
  source: string;
  /** Its id in the source (unique per source) — what makes recording it twice change nothing. */
  sourceRef: string;
  title: string;
  summary: string;
  /** Who did it, as a ref ("person:12"); "" when not known (or it was you). */
  actorRef: string;
  /** Where it opens (in Zeff or in its source); "" when nowhere. */
  url: string;
  data: Record<string, unknown>;
  /** The entities it concerns. */
  refs: string[];
};

export type EventInput = { at: string; kind: string; source: string; sourceRef: string; title: string; summary?: string; actorRef?: string; url?: string; data?: Record<string, unknown>; refs?: string[] };

const TITLE = 200;
const SUMMARY = 400;
const clip = (s: unknown, n: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

function db() {
  const d = getSqlite();
  d.exec(`
    create table if not exists tl_events (id integer primary key autoincrement, at text not null, kind text not null, source text not null, source_ref text not null, title text not null default '', summary text not null default '', actor_ref text not null default '', url text not null default '', data text not null default '{}', unique (source, source_ref));
    create index if not exists tl_events_at on tl_events (at);
    create table if not exists tl_event_refs (event_id integer not null references tl_events(id) on delete cascade, ref text not null, primary key (event_id, ref));
    create index if not exists tl_event_refs_ref on tl_event_refs (ref, event_id);
    create table if not exists tl_seen (ref text primary key, at text not null);
  `);
  return d;
}

/** A ref as kept: "kind:value", trimmed; a ticket's key in capitals. Empty when it isn't one. */
export function normRef(ref: string): string {
  const r = String(ref ?? "").trim();
  const m = /^([a-z]+):(.+)$/.exec(r);
  if (!m) return "";
  return m[1] === "ticket" ? `ticket:${m[2].toUpperCase()}` : `${m[1]}:${m[2]}`;
}

/**
 * An event kept — once per (source, source_ref): recorded again, nothing changes and its id is returned (`created` false). With
 * `merge`, an event already there takes the new title, summary, time and data (a day's changes to a row gathered in one) and the new
 * refs are added.
 */
export function recordEvent(v: EventInput, opts: { merge?: boolean } = {}): { id: number; created: boolean } {
  const d = db();
  const refs = [...new Set((v.refs ?? []).map(normRef).filter(Boolean))];
  const r = d
    .prepare("insert or ignore into tl_events (at, kind, source, source_ref, title, summary, actor_ref, url, data) values (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(v.at, v.kind, v.source, v.sourceRef, clip(v.title, TITLE), clip(v.summary, SUMMARY), normRef(v.actorRef ?? ""), String(v.url ?? "").slice(0, 1000), JSON.stringify(v.data ?? {}));
  const created = r.changes > 0;
  const id = created ? Number(r.lastInsertRowid) : (d.prepare("select id from tl_events where source = ? and source_ref = ?").get(v.source, v.sourceRef) as { id: number }).id;
  if (!created && !opts.merge) return { id, created };
  if (!created) d.prepare("update tl_events set at = ?, title = ?, summary = ?, data = ? where id = ?").run(v.at, clip(v.title, TITLE), clip(v.summary, SUMMARY), JSON.stringify(v.data ?? {}), id);
  const add = d.prepare("insert or ignore into tl_event_refs (event_id, ref) values (?, ?)");
  for (const ref of refs) add.run(id, ref);
  return { id, created };
}

/** An event by its source and id there (null: not recorded). */
export function eventBySource(source: string, sourceRef: string): TimelineEvent | null {
  const r = db().prepare("select * from tl_events where source = ? and source_ref = ?").get(source, sourceRef) as Row | undefined;
  return r ? withRefs([r])[0] : null;
}

type Row = { id: number; at: string; kind: string; source: string; source_ref: string; title: string; summary: string; actor_ref: string; url: string; data: string };

function withRefs(rows: Row[]): TimelineEvent[] {
  if (!rows.length) return [];
  const d = db();
  const refs = new Map<number, string[]>();
  for (let i = 0; i < rows.length; i += 500) {
    const ids = rows.slice(i, i + 500).map((r) => r.id);
    for (const x of d.prepare(`select event_id, ref from tl_event_refs where event_id in (${ids.map(() => "?").join(",")}) order by ref`).all(...ids) as { event_id: number; ref: string }[]) {
      refs.set(x.event_id, [...(refs.get(x.event_id) ?? []), x.ref]);
    }
  }
  return rows.map((r) => {
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(r.data) as Record<string, unknown>;
    } catch {
      // kept as nothing
    }
    return { id: r.id, at: r.at, kind: r.kind, source: r.source, sourceRef: r.source_ref, title: r.title, summary: r.summary, actorRef: r.actor_ref, url: r.url, data, refs: refs.get(r.id) ?? [] };
  });
}

export type Filter = {
  /** From this time on (inclusive, ISO). */
  since?: string;
  /** Up to this time (inclusive, ISO). */
  until?: string;
  /** Kinds or their prefixes: "todo" is todo.created, todo.done …; "mail" is mail. */
  kinds?: string[];
  sources?: string[];
  limit?: number;
  /** Paging: only events older than this one (by time, then id) — the last one of the page before. */
  before?: { at: string; id: number };
};

function where(f: Filter, alias = "e"): { sql: string; args: unknown[] } {
  const parts: string[] = [];
  const args: unknown[] = [];
  if (f.since) parts.push(`${alias}.at >= ?`), args.push(f.since);
  if (f.until) parts.push(`${alias}.at <= ?`), args.push(f.until);
  if (f.kinds?.length) {
    parts.push(`(${f.kinds.map(() => `${alias}.kind = ? or ${alias}.kind like ?`).join(" or ")})`);
    for (const k of f.kinds) args.push(k, `${k}.%`);
  }
  if (f.sources?.length) parts.push(`${alias}.source in (${f.sources.map(() => "?").join(",")})`), args.push(...f.sources);
  if (f.before) parts.push(`(${alias}.at < ? or (${alias}.at = ? and ${alias}.id < ?))`), args.push(f.before.at, f.before.at, f.before.id);
  return { sql: parts.length ? parts.join(" and ") : "1", args };
}

const limitOf = (f: Filter, fallback = 50) => Math.max(1, Math.min(1000, Math.floor(f.limit ?? fallback)));

/** What happened with an entity (or any of several — a row and the person it stands for): the newest first. */
export function eventsFor(ref: string | string[], f: Filter = {}): TimelineEvent[] {
  const refs = [...new Set((Array.isArray(ref) ? ref : [ref]).map(normRef).filter(Boolean))];
  if (!refs.length) return [];
  const w = where(f);
  const rows = db()
    .prepare(`select e.* from tl_events e where e.id in (select event_id from tl_event_refs where ref in (${refs.map(() => "?").join(",")})) and ${w.sql} order by e.at desc, e.id desc limit ?`)
    .all(...refs, ...w.args, limitOf(f)) as Row[];
  return withRefs(rows);
}

/** Everything between two times (or with only one bound), newest first — optionally only what concerns some refs. */
export function eventsBetween(from: string | null, to: string | null, f: Omit<Filter, "since" | "until"> & { refs?: string[] } = {}): TimelineEvent[] {
  if (f.refs?.length) return eventsFor(f.refs, { ...f, since: from ?? undefined, until: to ?? undefined });
  const w = where({ ...f, since: from ?? undefined, until: to ?? undefined });
  return withRefs(db().prepare(`select e.* from tl_events e where ${w.sql} order by e.at desc, e.id desc limit ?`).all(...w.args, limitOf(f, 100)) as Row[]);
}

/** How many events an entity has (since a time) — and of which kinds. */
export function eventCounts(ref: string | string[], f: Pick<Filter, "since" | "until"> = {}): { total: number; byKind: Record<string, number>; last: string | null } {
  const refs = [...new Set((Array.isArray(ref) ? ref : [ref]).map(normRef).filter(Boolean))];
  if (!refs.length) return { total: 0, byKind: {}, last: null };
  const w = where(f);
  const rows = db()
    .prepare(`select e.kind, count(*) n, max(e.at) last from tl_events e where e.id in (select event_id from tl_event_refs where ref in (${refs.map(() => "?").join(",")})) and ${w.sql} group by e.kind`)
    .all(...refs, ...w.args) as { kind: string; n: number; last: string }[];
  const byKind = Object.fromEntries(rows.map((r) => [r.kind, r.n]));
  return { total: rows.reduce((s, r) => s + r.n, 0), byKind, last: rows.reduce<string | null>((m, r) => (!m || r.last > m ? r.last : m), null) };
}

/** The kinds of refs an event is grouped under: entities, not the event's own identity (its mail, its message, its entry). */
export const ENTITY_KINDS = ["person", "org", "place", "ticket", "page", "project", "job", "todo", "doc", "event"] as const;

export type ChangeGroup = { ref: string; count: number; last: string; kinds: Record<string, number>; events: TimelineEvent[] };

/**
 * What changed since a time, by the entity it concerns: each entity with how many events, of which kinds, its newest first (at most
 * `perGroup` of them) — the entities with most going on first. An event concerning two entities counts for both.
 */
export function changesSince(since: string, opts: { kinds?: string[]; sources?: string[]; refKinds?: string[]; limit?: number; perGroup?: number; until?: string } = {}): ChangeGroup[] {
  const events = eventsBetween(since, opts.until ?? null, { kinds: opts.kinds, sources: opts.sources, limit: 1000 });
  const wanted = new Set(opts.refKinds?.length ? opts.refKinds : ENTITY_KINDS);
  const groups = new Map<string, ChangeGroup>();
  for (const e of events) {
    for (const ref of e.refs) {
      if (!wanted.has(ref.split(":")[0])) continue;
      const g = groups.get(ref) ?? { ref, count: 0, last: e.at, kinds: {}, events: [] };
      g.count++;
      g.kinds[e.kind] = (g.kinds[e.kind] ?? 0) + 1;
      if (e.at > g.last) g.last = e.at;
      if (g.events.length < (opts.perGroup ?? 5)) g.events.push(e);
      groups.set(ref, g);
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || b.last.localeCompare(a.last)).slice(0, opts.limit ?? 50);
}

/** When you last looked at an entity's timeline (null: never) — "all" for the Timeline page itself. */
export function lastSeen(ref: string): string | null {
  return (db().prepare("select at from tl_seen where ref = ?").get(ref) as { at: string } | undefined)?.at ?? null;
}

/** You looked at it now (or at `at`). */
export function markSeen(ref: string, at = new Date().toISOString()): void {
  db().prepare("insert into tl_seen (ref, at) values (?, ?) on conflict(ref) do update set at = excluded.at").run(ref, at);
}

/** How many events there are, and the sources they came from — for the page's filters. */
export function timelineStats(): { total: number; sources: Record<string, number>; kinds: Record<string, number> } {
  const d = db();
  const sources = Object.fromEntries((d.prepare("select source, count(*) n from tl_events group by source").all() as { source: string; n: number }[]).map((r) => [r.source, r.n]));
  const kinds = Object.fromEntries((d.prepare("select kind, count(*) n from tl_events group by kind").all() as { kind: string; n: number }[]).map((r) => [r.kind, r.n]));
  return { total: Object.values(sources).reduce((s, n) => s + n, 0), sources, kinds };
}
