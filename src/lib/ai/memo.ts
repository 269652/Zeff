/**
 * What the AI answered, remembered (one table, ai_memo): for a scope (a task, a step: "ws-review", "ai-filter:<condition>"),
 * a ref (a row, a record, a prompt) and the hash of what went in — asked again only when the input changed. One current
 * answer per scope and ref: a new input replaces the old one. A mark "read at this version" is an answer too (value true).
 * Kept per account in its database, across restarts. The tables the features had before (ws_review, doc_reviewed …) are
 * moved in once (memoMigrate) or stay readable where their keys can't be moved. Server only.
 */
import { createHash } from "node:crypto";
import { getSqlite } from "@/db";
import { isDone, markDone } from "@/lib/once-done";

export type MemoEntry<T> = { hash: string; value: T; at: string };

function table() {
  const d = getSqlite();
  d.exec("create table if not exists ai_memo (scope text not null, ref text not null, hash text not null, value text not null, at text not null, primary key (scope, ref))");
  return d;
}

type Raw = { ref: string; hash: string; value: string; at: string };
const parse = <T>(r: Raw): MemoEntry<T> | null => {
  try {
    return { hash: r.hash, value: JSON.parse(r.value) as T, at: r.at };
  } catch {
    return null;
  }
};
const fresh = (at: string, maxAgeMs?: number) => !maxAgeMs || Date.now() - Date.parse(at) < maxAgeMs;

/** A hash of what goes in (any parts, in order). */
export const memoHash = (...parts: unknown[]): string => createHash("sha1").update(JSON.stringify(parts)).digest("hex");

/** What is kept for `scope`/`ref`, whatever its input was — null: nothing. */
export function memoPeek<T>(scope: string, ref: string): MemoEntry<T> | null {
  const r = table().prepare("select ref, hash, value, at from ai_memo where scope = ? and ref = ?").get(scope, ref) as Raw | undefined;
  return r ? parse<T>(r) : null;
}

/** The answer kept for `scope`/`ref` when it was made from this input (`maxAgeMs`: and not older) — undefined: ask. */
export function memoGet<T>(scope: string, ref: string, hash: string, maxAgeMs?: number): T | undefined {
  const e = memoPeek<T>(scope, ref);
  return e && e.hash === hash && fresh(e.at, maxAgeMs) ? e.value : undefined;
}

/** Everything kept for `scope`, by ref (to look many up at once). */
export function memoAll<T>(scope: string): Map<string, MemoEntry<T>> {
  const out = new Map<string, MemoEntry<T>>();
  for (const r of table().prepare("select ref, hash, value, at from ai_memo where scope = ?").all(scope) as Raw[]) {
    const e = parse<T>(r);
    if (e) out.set(r.ref, e);
  }
  return out;
}

/** An answer kept for `scope`/`ref` at this input (the one before it replaced). */
export function memoSet<T>(scope: string, ref: string, hash: string, value: T, at = new Date().toISOString()): void {
  table().prepare("insert into ai_memo (scope, ref, hash, value, at) values (?, ?, ?, ?, ?) on conflict(scope, ref) do update set hash = excluded.hash, value = excluded.value, at = excluded.at").run(scope, ref, hash, JSON.stringify(value ?? null), at);
}

/** Many answers kept at once (one transaction). */
export function memoSetMany<T>(scope: string, entries: { ref: string; hash: string; value: T }[]): void {
  if (!entries.length) return;
  const d = table();
  const at = new Date().toISOString();
  const put = d.prepare("insert into ai_memo (scope, ref, hash, value, at) values (?, ?, ?, ?, ?) on conflict(scope, ref) do update set hash = excluded.hash, value = excluded.value, at = excluded.at");
  d.transaction(() => entries.forEach((e) => put.run(scope, e.ref, e.hash, JSON.stringify(e.value ?? null), at)))();
}

/** What is kept for `scope` dropped (only `ref`'s, when given) — asked again next time. */
export function memoForget(scope: string, ref?: string): void {
  if (ref === undefined) table().prepare("delete from ai_memo where scope = ?").run(scope);
  else table().prepare("delete from ai_memo where scope = ? and ref = ?").run(scope, ref);
}

/** The scopes starting with `prefix` emptied of what is older than `maxAgeMs` (answers nobody asks for any more). */
export function memoPrune(prefix: string, maxAgeMs: number): void {
  table().prepare("delete from ai_memo where scope like ? and at < ?").run(`${prefix.replace(/[%_]/g, "")}%`, new Date(Date.now() - maxAgeMs).toISOString());
}

/**
 * The answer for `scope`/`ref` at `inputHash`: the kept one, or `compute`d and kept (`force`: computed anyway; `maxAgeMs`: a
 * kept one older than that is computed again; `keep`: whether an answer is worth keeping — a failed one isn't).
 */
export async function memo<T>(scope: string, ref: string, inputHash: string, compute: () => T | Promise<T>, opts: { force?: boolean; maxAgeMs?: number; keep?: (v: T) => boolean } = {}): Promise<T> {
  if (!opts.force) {
    const hit = memoGet<T>(scope, ref, inputHash, opts.maxAgeMs);
    if (hit !== undefined) return hit;
  }
  const v = await compute();
  if (!opts.keep || opts.keep(v)) memoSet(scope, ref, inputHash, v);
  return v;
}

/**
 * A feature's own table moved into the memo once per account (`name` the move's): `select` gives rows of (scope, ref, hash,
 * value as JSON text, at). A table that isn't there: nothing to move. The old table is left as it is (an older Zeff reads it).
 */
export function memoMigrate(name: string, legacyTable: string, select: string): void {
  const key = `ai-memo:${name}@1`;
  if (isDone(key)) return;
  const d = table();
  if (d.prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(legacyTable)) {
    d.exec(`insert or ignore into ai_memo (scope, ref, hash, value, at) select scope, ref, hash, value, at from (${select})`);
  }
  markDone(key);
}
