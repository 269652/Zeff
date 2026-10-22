import { getSqlite } from "@/db";

/**
 * A database's rows by what their pages say (the Workspace plugin): the search box over a database looks in the cells it has —
 * this adds what is written on each row's page (a document's whole text, a mail's body, notes), from the search index, every
 * word by its beginning. Server only.
 */
export function rowsMatching(dbId: number, q: string, limit = 500): number[] {
  const words = q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  if (!words.length) return [];
  const match = words.slice(0, 8).map((w) => `"${w}"*`).join(" ");
  try {
    return (
      getSqlite()
        .prepare("select p.id from ws_fts join ws_pages p on p.id = ws_fts.rowid where ws_fts match ? and p.db_id = ? and p.archived_at is null and p.template = 0 limit ?")
        .all(match, dbId, limit) as { id: number }[]
    ).map((r) => r.id);
  } catch {
    // no index yet
    return [];
  }
}
