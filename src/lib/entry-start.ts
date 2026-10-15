import { inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { isoDate } from "./week";

const { todoTime, workRuns } = schema;

/**
 * A start time to offer for entries that have none: when the work on them began that day, from what
 * was logged on them — the earliest time record (an agent's or yours) or run on the entry's day,
 * "HH:MM" local. Entries with nothing dated that day get none.
 */
export function suggestedStarts(entries: { id: number; date: string }[]): Map<number, string> {
  const out = new Map<number, string>();
  if (!entries.length) return out;
  const ids = entries.map((e) => e.id);
  const dateOf = new Map(entries.map((e) => [e.id, e.date]));
  const best = new Map<number, Date>();
  const consider = (entryId: number | null, at: string | null, minutes = 0) => {
    if (entryId === null || !at) return;
    const d = new Date(new Date(at).getTime() - minutes * 60000); // (a record is made when its stretch is through)
    if (Number.isNaN(d.getTime()) || isoDate(d) !== dateOf.get(entryId)) return;
    const have = best.get(entryId);
    if (!have || d < have) best.set(entryId, d);
  };
  for (const r of getDb().select({ entryId: todoTime.entryId, at: todoTime.at, minutes: todoTime.minutes }).from(todoTime).where(inArray(todoTime.entryId, ids)).all()) consider(r.entryId, r.at, r.minutes);
  for (const r of getDb().select({ entryId: workRuns.entryId, at: workRuns.startedAt }).from(workRuns).where(inArray(workRuns.entryId, ids)).all()) consider(r.entryId, r.at);
  for (const [id, d] of best) out.set(id, `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
  return out;
}

