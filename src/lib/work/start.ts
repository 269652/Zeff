import { inArray, or } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { isoDate } from "@/lib/week";

const { todoTime, workRuns } = schema;

/**
 * When the work on a todo (or several) began on a day — as it was recorded, never as "now": the earliest
 * of the runs' start (an agent's `start_todo`, a worker's start) and, for each time record, the end of that
 * stretch minus its minutes (a record is made when a phase is through, so its timestamp is its END).
 * "HH:MM" local; null when nothing dated that day is on record (then the entry has no start — it is not guessed).
 */
export function workStart(date: string, ev: { todoIds?: number[]; runIds?: number[]; timeIds?: number[] }): string | null {
  const todoIds = ev.todoIds ?? [];
  const runIds = ev.runIds ?? [];
  const timeIds = ev.timeIds ?? [];
  const starts: Date[] = [];
  const add = (iso: string | null | undefined, minutes = 0) => {
    if (!iso) return;
    const d = new Date(new Date(iso).getTime() - minutes * 60000);
    if (!Number.isNaN(d.getTime()) && isoDate(d) === date) starts.push(d);
  };
  const runWhere = [todoIds.length ? inArray(workRuns.todoId, todoIds) : undefined, runIds.length ? inArray(workRuns.id, runIds) : undefined].filter(Boolean);
  if (runWhere.length) for (const r of getDb().select({ at: workRuns.startedAt }).from(workRuns).where(or(...runWhere)).all()) add(r.at);
  const timeWhere = [todoIds.length ? inArray(todoTime.todoId, todoIds) : undefined, timeIds.length ? inArray(todoTime.id, timeIds) : undefined].filter(Boolean);
  if (timeWhere.length) for (const r of getDb().select({ at: todoTime.at, minutes: todoTime.minutes }).from(todoTime).where(or(...timeWhere)).all()) add(r.at, r.minutes);
  const first = starts.sort((a, b) => a.getTime() - b.getTime())[0];
  return first ? `${String(first.getHours()).padStart(2, "0")}:${String(first.getMinutes()).padStart(2, "0")}` : null;
}
