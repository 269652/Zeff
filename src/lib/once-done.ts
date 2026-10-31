/**
 * One-time work that is done for good (moving old data to a new shape): kept per account in its database (migrations_done), so
 * it is not looked for again at every start or page setup. A key names the work and its version ("workspace.dataBlocks@1"):
 * a change to what it does takes a new version, and it runs once more. Work that fails (throws, or says it isn't complete)
 * isn't marked and is tried again the next time. Server only.
 */
import { getSqlite } from "@/db";

function table() {
  const d = getSqlite();
  d.exec("create table if not exists migrations_done (key text primary key, at text not null)");
  return d;
}

/** Whether the work of `key` is done in this account. */
export function isDone(key: string): boolean {
  return !!table().prepare("select 1 from migrations_done where key = ?").get(key);
}

/** When the work of `key` was last marked done in this account (an ISO time) — null: never. */
export function lastDone(key: string): string | null {
  return (table().prepare("select at from migrations_done where key = ?").get(key) as { at: string } | undefined)?.at ?? null;
}

/** The work of `key` marked done in this account (at `at`: by default now — work that goes on from there gives when it began). */
export function markDone(key: string, at = new Date().toISOString()): void {
  table().prepare("insert or replace into migrations_done (key, at) values (?, ?)").run(key, at);
}

/**
 * `fn` run once in this account: not at all when `key` is done, else run and marked done — unless it throws or `complete`
 * says no (a part failed: the next time tries again). Its result, or undefined when it didn't run.
 */
export async function onceDone<T>(key: string, fn: () => T | Promise<T>, complete: (r: T) => boolean = () => true): Promise<T | undefined> {
  if (isDone(key)) return undefined;
  const r = await fn();
  if (complete(r)) markDone(key);
  return r;
}
