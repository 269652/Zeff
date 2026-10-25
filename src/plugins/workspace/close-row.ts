import { getPref, setPref } from "@/lib/prefs";
import { t } from "@/lib/i18n/server";
import { discardIfUntouched } from "./fresh-rows";
import { dateRange } from "./model";
import { addRow, getDatabase, getPage, updatePage } from "./store";

/**
 * A row closed (the Workspace): a day of the journal done, a round of a checklist ticked through — the row is locked (read-only,
 * 🔒, under its database in the tree's "Closed") and the next one is there at once: the same database, every tick unticked, the
 * other fields empty, its date the day after the closed one's (today at the earliest). Opened again (undo, or "Open again" on the
 * closed one), the lock goes and the next row with it — if nothing was put in it yet. Server only.
 */

/** Which row each close made, and with which cells (to know it is untouched when it is opened again). */
const MADE = "workspace.closedNext";
type Made = Record<string, { next: number; cells: string[] }>;

const iso = (d: Date) => d.toLocaleDateString("sv-SE");
const dayAfter = (day: string) => {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return iso(d);
};

/** The next row's cells: its ticks unticked, the first date the day after the closed row's (not before today), nothing else. */
export function nextCells(props: { id: string; type: string }[], closed: Record<string, unknown>, today = iso(new Date())): Record<string, unknown> {
  const cells: Record<string, unknown> = {};
  for (const p of props) if (p.type === "checkbox") cells[p.id] = false;
  const date = props.find((p) => p.type === "date");
  const was = date ? dateRange(closed[date.id])?.start.slice(0, 10) : undefined;
  if (date) {
    const next = was && /^\d{4}-\d{2}-\d{2}$/.test(was) ? dayAfter(was) : today;
    cells[date.id] = next < today ? today : next;
  }
  return cells;
}

/** Closes a row and makes its next one. Returns the new row's id. */
export function closeRow(rowId: number): number {
  const row = getPage(rowId);
  if (!row?.dbId) throw new Error(t("No such row."));
  if (row.locked) throw new Error(t("This entry is closed already."));
  const db = getDatabase(row.dbId);
  if (!db) throw new Error(t("This database is gone."));
  updatePage(rowId, { locked: true });
  const cells = nextCells(db.schema.properties, row.props);
  const next = addRow(row.dbId, { cells });
  setPref(MADE, { ...getPref<Made>(MADE, {}), [rowId]: { next, cells: Object.keys(cells) } });
  return next;
}

/** A closed row open again: unlocked; the row its close made goes to the bin if it is still untouched. Whether that one went. */
export function reopenRow(rowId: number): { discarded: boolean } {
  const row = getPage(rowId);
  if (!row?.dbId) throw new Error(t("No such row."));
  updatePage(rowId, { locked: false });
  const made = getPref<Made>(MADE, {});
  const mine = made[rowId];
  const { [rowId]: _gone, ...rest } = made;
  setPref(MADE, rest);
  return { discarded: mine ? discardIfUntouched(mine.next, mine.cells) : false };
}
