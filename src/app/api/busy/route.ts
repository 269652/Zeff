import { connection } from "next/server";

/**
 * What this server is doing right now that a restart would cut off — work that lives only in its
 * memory: a Ticket-Lage run's own steps after the Lage (mail and note reviews, the relations, the
 * auto-actions; the run's row says "ok" already), syncs from the menu or the scheduler, a Keep
 * board sync, a Keep read, the search for people's dates. `npm run deploy` waits for it.
 */
export async function GET() {
  await connection();
  const g = globalThis as {
    __zeffBoardRun?: { id: number; phase: string } | null;
    __zeffSyncs?: { running: Set<string>; all: string | null | undefined };
    __zeffBoardSync?: { boardId: number } | null;
    __zeffKeepSyncing?: boolean;
    __zeffPeopleDates?: { done: number; total: number } | null;
  };
  const busy: string[] = [];
  if (g.__zeffBoardRun) busy.push(`Ticket-Lage run #${g.__zeffBoardRun.id} (${g.__zeffBoardRun.phase})`);
  for (const key of g.__zeffSyncs?.running ?? []) busy.push(`sync ${key}`);
  if (g.__zeffSyncs && g.__zeffSyncs.all !== undefined) busy.push("Sync all");
  if (g.__zeffBoardSync) busy.push(`Keep board sync (board ${g.__zeffBoardSync.boardId})`);
  if (g.__zeffKeepSyncing) busy.push("Keep sync");
  if (g.__zeffPeopleDates) busy.push(`people's dates (${g.__zeffPeopleDates.done}/${g.__zeffPeopleDates.total})`);
  return Response.json({ busy });
}
