import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { TodoTime } from "@/db/schema";
import { todoRef } from "@/lib/boards/shared";
import { ValidationError } from "@/lib/errors";
import { emitChange } from "@/lib/events";
import { t } from "@/lib/i18n/server";
import { timeRef, type TimeRecord } from "./shared";

const { todoTime, workRuns } = schema;

export const MAX_TIME_MINUTES = 1440;

/** One line: the first, trimmed, at most 200 characters. */
const oneLine = (s: string) => {
  const line = s.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
  return line.length > 200 ? `${line.slice(0, 199)}…` : line;
};

const view = (r: TodoTime): TimeRecord => ({
  id: r.id,
  ref: timeRef(r.id),
  todoId: r.todoId,
  todo: todoRef(r.todoId),
  minutes: r.minutes,
  note: r.note,
  by: r.reportedBy,
  runId: r.runId,
  source: r.source === "hand" ? "hand" : "agent",
  at: r.at,
  suggestionId: r.suggestionId,
  entryId: r.entryId,
});

/**
 * The work run a record belongs to: "W-45" or "W-45 · Session" in the agent's name (a worker
 * reports under its run's number) — else the agent's own running run on the todo.
 */
function runOf(todoId: number, agent: string): number | null {
  const m = /^W-(\d+)\b/.exec(agent.trim());
  if (m) {
    const run = getDb().select({ id: workRuns.id }).from(workRuns).where(eq(workRuns.id, Number(m[1]))).get();
    if (run) return run.id;
  }
  const mine = getDb()
    .select({ id: workRuns.id })
    .from(workRuns)
    .where(and(eq(workRuns.todoId, todoId), eq(workRuns.provider, "agent"), eq(workRuns.status, "running")))
    .all();
  return mine.length ? mine[mine.length - 1].id : null;
}

/** Validated minutes: a whole number, 1 to 1440 (a day). */
export function checkMinutes(v: number): number {
  const minutes = Math.round(Number(v));
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > MAX_TIME_MINUTES) throw new ValidationError(t("Minutes: 1 to {max}.", { max: MAX_TIME_MINUTES }));
  return minutes;
}

/**
 * Time on a todo, one stretch of work: its minutes and one line of what was done. A todo gets
 * many of them (after each phase, at a pause, at the end). `run`: the work run it happened in
 * (default: found from the agent's name).
 */
export function addTodoTime(v: { todoId: number; minutes: number; note?: string; by?: string; source?: "agent" | "hand"; runId?: number | null; at?: string }): TimeRecord {
  const todo = getDb().select({ id: schema.todos.id }).from(schema.todos).where(eq(schema.todos.id, v.todoId)).get();
  if (!todo) throw new ValidationError(t("{ref} doesn't exist.", { ref: todoRef(v.todoId) }));
  const minutes = checkMinutes(v.minutes);
  const source = v.source === "hand" ? "hand" : "agent";
  const by = (v.by ?? "").trim().slice(0, 60) || (source === "hand" ? "Du" : "Agent");
  const at = v.at && !Number.isNaN(Date.parse(v.at)) ? new Date(v.at).toISOString() : new Date().toISOString();
  const row = getDb()
    .insert(todoTime)
    .values({
      todoId: v.todoId,
      minutes,
      note: oneLine(v.note ?? ""),
      reportedBy: by,
      runId: v.runId !== undefined ? v.runId : source === "agent" ? runOf(v.todoId, by) : null,
      source,
      at,
      createdAt: new Date().toISOString(),
    })
    .returning()
    .get();
  emitChange("work");
  return view(row);
}

/** The records on these todos, in the order they happened. `open`: only those not booked (and not marked not to be). */
export function listTodoTimes(todoIds: number[], opts: { open?: boolean } = {}): TimeRecord[] {
  if (!todoIds.length) return [];
  const where = opts.open ? and(inArray(todoTime.todoId, todoIds), isNull(todoTime.entryId)) : inArray(todoTime.todoId, todoIds);
  return getDb().select().from(todoTime).where(where).orderBy(asc(todoTime.at), asc(todoTime.id)).all().map(view);
}

export function timesByIds(ids: number[]): TimeRecord[] {
  if (!ids.length) return [];
  return getDb().select().from(todoTime).where(inArray(todoTime.id, ids)).orderBy(asc(todoTime.at), asc(todoTime.id)).all().map(view);
}

/** Minutes per todo (all its records, booked or not) — what a list shows. */
export function timeTotals(todoIds: number[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const r of listTodoTimes(todoIds)) out.set(r.todoId, (out.get(r.todoId) ?? 0) + r.minutes);
  return out;
}

const requireOpen = (id: number): TodoTime => {
  const r = getDb().select().from(todoTime).where(eq(todoTime.id, id)).get();
  if (!r) throw new ValidationError(t("{ref} doesn't exist.", { ref: timeRef(id) }));
  if (r.entryId != null || r.suggestionId != null) throw new ValidationError(t("{ref} is covered by a booking or a suggestion already — it can't be changed any more.", { ref: timeRef(id) }));
  return r;
};

/** Change a record that isn't booked or suggested. */
export function updateTodoTime(id: number, patch: { minutes?: number; note?: string }): TimeRecord {
  requireOpen(id);
  const set: Partial<TodoTime> = {};
  if (patch.minutes !== undefined) set.minutes = checkMinutes(patch.minutes);
  if (patch.note !== undefined) set.note = oneLine(patch.note);
  if (Object.keys(set).length) getDb().update(todoTime).set(set).where(eq(todoTime.id, id)).run();
  emitChange("work");
  return view(getDb().select().from(todoTime).where(eq(todoTime.id, id)).get()!);
}

/** Delete a record — only while it isn't booked or suggested. */
export function deleteTodoTime(id: number): void {
  requireOpen(id);
  getDb().delete(todoTime).where(eq(todoTime.id, id)).run();
  emitChange("work");
}

/** Booked into an entry (`entryId`; -1: marked not to be booked) — those still open only. */
export function markTimeBooked(ids: number[], entryId: number): void {
  if (!ids.length) return;
  getDb().update(todoTime).set({ entryId }).where(and(inArray(todoTime.id, ids), isNull(todoTime.entryId))).run();
}

/** Covered by a suggestion (null: free again, when it is withdrawn). */
export function markTimeSuggested(ids: number[], suggestionId: number | null): void {
  if (!ids.length) return;
  getDb().update(todoTime).set({ suggestionId }).where(inArray(todoTime.id, ids)).run();
}
