import { and, eq, isNotNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { addEvent, deleteEvent, updateEvent, zeffCalendar } from "@/lib/calendar/ir";
import { addDays, occurrenceDays, parseRecurrence, type Recurrence } from "@/lib/calendar/recurrence";
import { dueDay } from "./shared";

const { todos, calendarEvents } = schema;

/**
 * Todos that come back (a rate to pay on the 15th of every month). The rule is kept on the todo; Zeff's calendar shows it as a series
 * (an all-day appointment from the due day, on the todo); when the todo is done the next one is made — the same text and actions,
 * due on the next day the rule names. A todo dropped (not done) is not made again.
 */

const FAR = "2100-01-01";
const today = () => new Date().toLocaleDateString("sv-SE");

/** The next due day after `due` that is not in the past (`from`: today) — null when the rule has ended (its last day, its count). */
export function nextDue(rule: Recurrence, due: string, from = today()): string | null {
  // (The count is what is left, the todo being due now counted: the next todo carries one less.)
  if (rule.count !== undefined && rule.count <= 1) return null;
  const days = occurrenceDays(due, rule, FAR, 4000);
  return days.find((d) => d > due && d >= from) ?? null;
}

/** The series of the calendar for a todo: its appointment, if any. */
const seriesOf = (todoId: number) => getDb().select().from(calendarEvents).where(and(eq(calendarEvents.todoId, todoId), isNotNull(calendarEvents.recurrence))).get();

const titleOf = (text: string) => `↻ ${text.replace(/\s+/g, " ").trim()}`.slice(0, 120);

/** The calendar's series follows the todo: made, changed, or taken away (no rule, no due day, no longer open). */
export function syncSeries(todoId: number): void {
  const t = getDb().select().from(todos).where(eq(todos.id, todoId)).get();
  const rule = parseRecurrence(t?.recurrence);
  const start = t ? dueDay(t.due) : null;
  const had = seriesOf(todoId);
  if (!t || !rule || !start || t.status !== "open") {
    if (had && !(t && rule && t.status !== "open")) deleteEvent(had.id);
    return;
  }
  const patch = { title: titleOf(t.text), start, end: addDays(start, 1), allDay: true, recurrence: rule, todoId, showAs: "free" };
  if (had) updateEvent(had.id, patch);
  else addEvent(zeffCalendar().id, patch);
}

/** A todo's rule set (null: taken away). The calendar's series follows. */
export function setRecurrence(todoId: number, rule: Recurrence | null): void {
  const clean = rule ? parseRecurrence(rule) : null;
  getDb().update(todos).set({ recurrence: clean ? JSON.stringify(clean) : null, updatedAt: new Date().toISOString() }).where(eq(todos.id, todoId)).run();
  syncSeries(todoId);
}

/**
 * A todo with a rule was done: the next one is made (a copy that is open again, due on the next day of the rule) and takes over the
 * calendar's series. Returns its id; null: it has no rule, no due day, or the rule has ended.
 */
export function spawnNext(todoId: number): number | null {
  const db = getDb();
  const t = db.select().from(todos).where(eq(todos.id, todoId)).get();
  const rule = parseRecurrence(t?.recurrence);
  const due = t ? dueDay(t.due) : null;
  if (!t || !rule || !due) return null;
  const next = nextDue(rule, due);
  if (!next) {
    const had = seriesOf(todoId);
    if (had) deleteEvent(had.id);
    return null;
  }
  const { id: _id, ...copy } = t;
  const now = new Date().toISOString();
  const made = db
    .insert(todos)
    .values({
      ...copy,
      status: "open",
      due: next,
      doneAt: null,
      note: null,
      runId: null,
      entryId: null,
      workerDone: null,
      deferredAt: null,
      actionsReviewedAt: null,
      mergedInto: null,
      mergedAt: null,
      parentId: null,
      workRunId: null,
      recurrence: JSON.stringify(rule.count !== undefined ? { ...rule, count: rule.count - 1 } : rule),
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  // The series goes on with the new one.
  const had = seriesOf(todoId);
  if (had) db.update(calendarEvents).set({ todoId: made.id }).where(eq(calendarEvents.id, had.id)).run();
  else syncSeries(made.id);
  return made.id;
}
