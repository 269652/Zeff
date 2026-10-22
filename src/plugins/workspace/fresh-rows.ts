import { archivePage, getDatabase, getPage } from "./store";

/**
 * A row made with New and closed again without anything in it — no name, nothing written on its page, no value but those it was
 * made with (`madeWith`: the cells it got; a date starting with today counts as made with) — goes to the bin: New leaves no empty
 * rows behind. Whether it went. Server only.
 */
export function discardIfUntouched(rowId: number, madeWith: string[]): boolean {
  const row = getPage(rowId);
  if (!row || row.archivedAt || row.dbId === null || row.title.trim()) return false;
  if (/"text"\s*:\s*"[^"]*\S/.test(JSON.stringify(row.content ?? ""))) return false;
  const db = getDatabase(row.dbId);
  if (!db) return false;
  const today = new Date().toLocaleDateString("sv-SE");
  const ownCells = Object.entries(row.props ?? {}).filter(([k, v]) => {
    if (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length)) return false;
    if (madeWith.includes(k)) return false;
    const p = db.schema.properties.find((x) => x.id === k);
    return !(p?.type === "date" && p.defaultToday && v === today);
  });
  if (ownCells.length) return false;
  archivePage(rowId);
  return true;
}
