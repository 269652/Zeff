/**
 * What this server is doing that lives in its memory only, so a restart would cut it off: a Ticket-Lage run's own
 * steps after the Lage (mail and note reviews, the relations, the auto-actions; the run's row says "ok" by then),
 * syncs from the menu or the scheduler, a Keep board sync, a Keep read, the search for people's dates.
 * `npm run deploy` waits for it — on the sync host, which is where it runs; a web server that hands its work
 * to a sync host has none of it (what it shows of the host is a copy: see mirror.ts).
 */
import { delegates } from "./role";

type Globals = {
  __zeffSyncsByAccount?: Record<string, { running: Set<string>; all: string | null | undefined }>;
  __zeffBoardSync?: { boardId: number } | null;
  __zeffAccountFlags?: Record<string, Record<string, unknown>>;
  __zeffPeopleDates?: { done: number; total: number } | null;
};

export function busyThings(): string[] {
  if (delegates()) return [];
  const g = globalThis as Globals;
  const busy: string[] = [];
  const each = <T>(name: string) => Object.entries(g.__zeffAccountFlags?.[name] ?? {}) as [string, T][];
  for (const [account, r] of each<{ id: number; phase: string }>("__zeffBoardRun")) busy.push(`briefing run #${r.id} (${r.phase}, ${account})`);
  // Every account's: each syncs on its own.
  for (const [account, s] of Object.entries(g.__zeffSyncsByAccount ?? {})) {
    for (const key of s.running) busy.push(`sync ${key} (${account})`);
    if (s.all !== undefined) busy.push(`Sync all (${account})`);
  }
  if (g.__zeffBoardSync) busy.push(`Keep board sync (board ${g.__zeffBoardSync.boardId})`);
  for (const [account] of each("__zeffKeepSyncing")) busy.push(`Keep sync (${account})`);
  if (g.__zeffPeopleDates) busy.push(`people's dates (${g.__zeffPeopleDates.done}/${g.__zeffPeopleDates.total})`);
  for (const [account, r] of each<{ day: string }>("__zeffRecap")) busy.push(`day recap ${r.day} (${account})`);
  return busy;
}
