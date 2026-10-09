import { and, asc, desc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { ValidationError } from "./errors";
import { parsePauses, parseTime, type PauseRange } from "./pauses-shared";
import { isValidIsoDate } from "./week";

const { pauses } = schema;

/** A zero-length row (00:00–00:00) marks a day that explicitly had no break. */
const NO_BREAK_MARK = { start: "00:00", end: "00:00" };
const isRealBreak = sql`${pauses.start} < ${pauses.end}`;

/**
 * The breaks within [from, to] by ISO date, earliest first. A day marked "no break"
 * maps to [] — a day with nothing entered has no key at all.
 */
export function listPausesByDate(from: string, to: string): Record<string, PauseRange[]> {
  const rows = getDb()
    .select()
    .from(pauses)
    .where(and(gte(pauses.date, from), lte(pauses.date, to)))
    .orderBy(asc(pauses.date), asc(pauses.start))
    .all();
  const byDate: Record<string, PauseRange[]> = {};
  for (const r of rows) {
    const day = (byDate[r.date] ??= []);
    if (r.start < r.end) day.push({ start: r.start, end: r.end });
  }
  return byDate;
}

/** The breaks of the latest day before `date` that has any — offered again for days without one. */
export function latestPausesBefore(date: string): PauseRange[] {
  const db = getDb();
  const last = db
    .select({ date: pauses.date })
    .from(pauses)
    .where(and(lt(pauses.date, date), isRealBreak))
    .orderBy(desc(pauses.date))
    .limit(1)
    .get();
  if (!last) return [];
  return db
    .select()
    .from(pauses)
    .where(and(eq(pauses.date, last.date), isRealBreak))
    .orderBy(asc(pauses.start))
    .all()
    .map((r) => ({ start: r.start, end: r.end }));
}

/**
 * Replace the breaks of each given day with the ones in `text` (read like the editor:
 * "12:00-12:30", "12 30m", …). Empty removes what was entered; "none" marks the days
 * as having had no break. A bare length starts at `defaultStart`.
 */
export function setPauses(
  dates: string[],
  text: string,
  defaultStart = "12:00",
): { pauses: PauseRange[]; none: boolean } {
  if (dates.length === 0 || dates.length > 7 || !dates.every(isValidIsoDate)) {
    throw new ValidationError("Pick the day(s) to set the break on.");
  }
  const parsed = parsePauses(text, parseTime(defaultStart) ?? "12:00");
  if (!parsed.ok) throw new ValidationError(parsed.error);
  const rows = parsed.none ? [NO_BREAK_MARK] : parsed.pauses;
  getDb().transaction((tx) => {
    tx.delete(pauses).where(inArray(pauses.date, dates)).run();
    if (rows.length) tx.insert(pauses).values(dates.flatMap((date) => rows.map((p) => ({ date, ...p })))).run();
  });
  return { pauses: parsed.pauses, none: !!parsed.none };
}
