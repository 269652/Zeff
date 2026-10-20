import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { addEvent, deleteEvent, updateEvent, zeffCalendar } from "@/lib/calendar/ir";
import { addDays, occurrenceDays, parseTodoRecurrence, type TodoRecurrence } from "@/lib/calendar/recurrence";
import { getPref, setPref } from "@/lib/prefs";
import { recurrenceFromText } from "./recurrence-text";
import { dueDay } from "./shared";

const { todos, calendarEvents } = schema;

/**
 * Todos that come back (a rate to pay on the 15th of every month). The rule is kept on the todo; Zeff's calendar shows it: the first due
 * day as an appointment of its own when the repeats begin later (pay now, then every 15th — the rule's `start`), and the repeats as a
 * series; when the todo is done the next one is made — the same text and actions, due on the next day the rule names. A todo dropped (not
 * done) is not made again. The appointments belong to the todo (`todo_id`): its context shows them.
 */

const FAR = "2100-01-01";
const today = () => new Date().toLocaleDateString("sv-SE");

/** The next due day after `due` that is not in the past (`from`: today) — null when the rule has ended (its last day, its count). */
export function nextDue(rule: TodoRecurrence, due: string, from = today()): string | null {
  // (The count is what is left, the todo being due now counted: the next todo carries one less — once the repeats have begun.)
  if (rule.count !== undefined && rule.count <= 1 && (!rule.start || due >= rule.start)) return null;
  const days = occurrenceDays(rule.start ?? due, rule, FAR, 4000);
  return days.find((d) => d > due && d >= from) ?? null;
}

/** The series of the calendar for a todo (its repeats), and the appointment of its first due day. */
const seriesOf = (todoId: number) => getDb().select().from(calendarEvents).where(and(eq(calendarEvents.todoId, todoId), isNotNull(calendarEvents.recurrence))).get();
const singleOf = (todoId: number) => getDb().select().from(calendarEvents).where(and(eq(calendarEvents.todoId, todoId), isNull(calendarEvents.recurrence))).get();

/** The appointments are the todo's context: their refs ("cal:<id>") are among what it is related to (the todo's mail_refs). */
function relate(todoId: number): void {
  const row = getDb().select({ refs: todos.mailRefs }).from(todos).where(eq(todos.id, todoId)).get();
  if (!row) return;
  let had: string[] = [];
  try {
    had = (JSON.parse(row.refs) as unknown[]).filter((r): r is string => typeof r === "string");
  } catch {
    // (none)
  }
  const mine = [seriesOf(todoId), singleOf(todoId)].flatMap((e) => (e ? [`cal:${e.id}`] : []));
  const next = [...had.filter((r) => !r.startsWith("cal:")), ...mine];
  if (JSON.stringify(next) !== JSON.stringify(had)) getDb().update(todos).set({ mailRefs: JSON.stringify(next) }).where(eq(todos.id, todoId)).run();
}

const titleOf = (text: string, repeat: boolean) => `${repeat ? "↻ " : ""}${text.replace(/\s+/g, " ").trim()}`.slice(0, 120);

/** The calendar's appointments follow the todo: made, changed, or taken away (no rule, no due day). A todo that is done keeps them. */
export function syncSeries(todoId: number): void {
  syncEvents(todoId);
  relate(todoId);
}

function syncEvents(todoId: number): void {
  const t = getDb().select().from(todos).where(eq(todos.id, todoId)).get();
  const rule = parseTodoRecurrence(t?.recurrence);
  const due = t ? dueDay(t.due) : null;
  const series = seriesOf(todoId);
  const single = singleOf(todoId);
  if (!t || !rule) {
    if (series) deleteEvent(series.id);
    return;
  }
  if (t.status !== "open") return; // (done: they stay — the next todo takes the series over)
  const first = rule.start ?? due;
  if (!first) {
    if (series) deleteEvent(series.id);
    return;
  }
  const make = (patch: Parameters<typeof addEvent>[1], had: typeof series) => (had ? updateEvent(had.id, patch) : addEvent(zeffCalendar().id, patch));
  make({ title: titleOf(t.text, true), start: first, end: addDays(first, 1), allDay: true, recurrence: rule, todoId, showAs: "free" }, series);
  // The first due day is its own appointment when the repeats begin later.
  if (rule.start && due && due < rule.start) make({ title: titleOf(t.text, false), start: due, end: addDays(due, 1), allDay: true, todoId, showAs: "free" }, single);
  else if (single) deleteEvent(single.id);
}

/** A todo's rule set (null: taken away). The calendar follows. */
export function setRecurrence(todoId: number, rule: TodoRecurrence | null): void {
  const clean = rule ? parseTodoRecurrence(rule) : null;
  getDb().update(todos).set({ recurrence: clean ? JSON.stringify(clean) : null, updatedAt: new Date().toISOString() }).where(eq(todos.id, todoId)).run();
  syncSeries(todoId);
}

/** The calendar's appointments of a todo made again from its rule and due day (the old ones go). */
export function regenerateSeries(todoId: number): void {
  for (const e of [seriesOf(todoId), singleOf(todoId)]) if (e) deleteEvent(e.id);
  syncSeries(todoId);
}

/**
 * A todo with a rule was done: the next one is made (a copy that is open again, due on the next day of the rule) and takes over the
 * calendar's series. Returns its id; null: it has no rule, no due day, or the rule has ended.
 */
export function spawnNext(todoId: number): number | null {
  const db = getDb();
  const t = db.select().from(todos).where(eq(todos.id, todoId)).get();
  const rule = parseTodoRecurrence(t?.recurrence);
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
  // (Once the repeats have begun every todo is one of them: one less to come.)
  const counted = rule.count !== undefined && (!rule.start || due >= rule.start);
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
      recurrence: JSON.stringify(counted ? { ...rule, count: rule.count! - 1 } : rule),
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  // The series goes on with the new one.
  const had = seriesOf(todoId);
  if (had) {
    db.update(calendarEvents).set({ todoId: made.id }).where(eq(calendarEvents.id, had.id)).run();
    relate(made.id);
  } else syncSeries(made.id);
  return made.id;
}

/**
 * After an evaluation: the open todos whose text names a repetition (“danach jeweils 300 € am 15. von 15.11.2026 bis 15.09.2027”) get
 * their rule — the day the repeats begin, their last day — and with it the series in the calendar. Each todo (its text) is looked at once:
 * a rule you set or took away by hand stays as you left it.
 */
export function detectRecurrences(): { set: number } {
  const key = "todos:recurrenceChecked";
  const seen = getPref<Record<string, string>>(key, {});
  const next: Record<string, string> = {};
  let set = 0;
  for (const t of getDb().select().from(todos).where(eq(todos.status, "open")).all()) {
    const mark = `${t.text.length}:${t.text.slice(0, 40)}${t.text.slice(-40)}`;
    next[t.id] = mark;
    if (seen[t.id] === mark || t.recurrence || t.byWorker) continue;
    const rule = recurrenceFromText(t.text, dueDay(t.due));
    if (!rule) continue;
    setRecurrence(t.id, rule);
    set++;
  }
  if (JSON.stringify(next) !== JSON.stringify(seen)) setPref(key, next);
  return { set };
}
