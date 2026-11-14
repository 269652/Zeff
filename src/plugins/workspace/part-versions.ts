import { getSqlite } from "@/db";
import { inAgentScope } from "./agent-scope";
import { inJournal, rememberUndo } from "./undo";

/**
 * Versions of the parts of an app that had none: a flow's definition, a database's fields, a routine, a form. Before such a part is
 * changed (by you, the AI, an update), the state it had is kept here — the newest PART_VERSIONS_KEPT per part — so any of them can be
 * looked at and brought back (part-restore.ts). A change saved again and again (a designer's autosave) keeps one version per few minutes,
 * not one per keystroke. Pages, view templates, widgets, blocks and plugin functions keep theirs in their own places. Server only.
 */

export const PART_VERSIONS_KEPT = 60;
export const PART_KINDS = ["flow", "fields", "routine", "form"] as const;
export type PartKind = (typeof PART_KINDS)[number];
export const isPartKind = (k: unknown): k is PartKind => (PART_KINDS as readonly string[]).includes(String(k));

export type PartVersion = { id: number; kind: PartKind; ref: number; at: string; by: string; size: number };
export type PartVersionFull = PartVersion & { body: unknown };

function db() {
  const d = getSqlite();
  d.exec(`
    create table if not exists ws_part_versions (id integer primary key autoincrement, kind text not null, ref integer not null, body text not null, by text not null default '', at text not null);
    create index if not exists ws_part_versions_part on ws_part_versions (kind, ref, id);
  `);
  return d;
}

type Row = { id: number; kind: string; ref: number; body: string; by: string; at: string };
const toVersion = (r: Row & { size?: number }): PartVersion => ({ id: r.id, kind: r.kind as PartKind, ref: r.ref, at: r.at, by: r.by, size: r.size ?? r.body.length });

/**
 * The state a part had, kept before it changes. Nothing is kept when it is the same as the newest version, or (with `gapMs`) when the
 * newest one was kept less than that long ago — the state before a run of quick saves is the one worth going back to.
 */
export function keepPartVersion(kind: PartKind, ref: number, before: unknown, opts: { gapMs?: number; by?: string } = {}): void {
  if (before === undefined || before === null) return;
  const body = JSON.stringify(before);
  const d = db();
  const last = d.prepare("select id, body, at from ws_part_versions where kind = ? and ref = ? order by id desc limit 1").get(kind, ref) as { id: number; body: string; at: string } | undefined;
  // (Inside an action that can be undone - an AI answer - the state before it is always kept: Undo brings exactly that back.)
  if (last && last.body === body) return void rememberUndo(`part:${kind}:${ref}`, { kind: "part", version: last.id });
  if (last && opts.gapMs && !inJournal() && Date.now() - Date.parse(last.at) < opts.gapMs) return;
  const r = d.prepare("insert into ws_part_versions (kind, ref, body, by, at) values (?, ?, ?, ?, ?)").run(kind, ref, body, opts.by ?? (inAgentScope() ? "ai" : "you"), new Date().toISOString());
  rememberUndo(`part:${kind}:${ref}`, { kind: "part", version: Number(r.lastInsertRowid) });
  d.prepare("delete from ws_part_versions where kind = ? and ref = ? and id not in (select id from ws_part_versions where kind = ? and ref = ? order by id desc limit ?)").run(kind, ref, kind, ref, PART_VERSIONS_KEPT);
}

/** A part's versions, newest first (without their content: its size instead). */
export const partVersions = (kind: PartKind, ref: number): PartVersion[] =>
  (db().prepare("select id, kind, ref, by, at, length(body) size, '' body from ws_part_versions where kind = ? and ref = ? order by id desc").all(kind, ref) as (Row & { size: number })[]).map(toVersion);

/** One of them in full. */
export function partVersion(id: number): PartVersionFull | null {
  const r = db().prepare("select * from ws_part_versions where id = ?").get(id) as Row | undefined;
  if (!r) return null;
  let body: unknown = null;
  try {
    body = JSON.parse(r.body);
  } catch {
    body = null;
  }
  return { ...toVersion(r), body };
}
