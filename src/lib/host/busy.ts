/**
 * What this server is doing that lives in its memory only, so a restart would cut it off: a Ticket-Lage run's own
 * steps after the Lage (mail and note reviews, the relations, the auto-actions; the run's row says "ok" by then),
 * syncs from the menu or the scheduler, a Keep board sync, a Keep read, the search for people's dates.
 * `npm run deploy` waits for it — on the sync host, which is where it runs; a web server that hands its work
 * to a sync host has none of it (what it shows of the host is a copy: see mirror.ts).
 */
import { delegates } from "./role";

type Globals = {
  __zeffBoardRun?: { id: number; phase: string } | null;
  __zeffSyncs?: { running: Set<string>; all: string | null | undefined };
  __zeffBoardSync?: { boardId: number } | null;
  __zeffKeepSyncing?: boolean;
  __zeffPeopleDates?: { done: number; total: number } | null;
  __zeffRecap?: { id: number; day: string } | null;
};

export function busyThings(): string[] {
  if (delegates()) return [];
  const g = globalThis as Globals;
  const busy: string[] = [];
  if (g.__zeffBoardRun) busy.push(`briefing run #${g.__zeffBoardRun.id} (${g.__zeffBoardRun.phase})`);
  for (const key of g.__zeffSyncs?.running ?? []) busy.push(`sync ${key}`);
  if (g.__zeffSyncs && g.__zeffSyncs.all !== undefined) busy.push("Sync all");
  if (g.__zeffBoardSync) busy.push(`Keep board sync (board ${g.__zeffBoardSync.boardId})`);
  if (g.__zeffKeepSyncing) busy.push("Keep sync");
  if (g.__zeffPeopleDates) busy.push(`people's dates (${g.__zeffPeopleDates.done}/${g.__zeffPeopleDates.total})`);
  if (g.__zeffRecap) busy.push(`day recap ${g.__zeffRecap.day}`);
  return busy;
}
