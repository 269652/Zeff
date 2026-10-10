/**
 * Appointments as todos: in a calendar set so ("Todos" — Zeff's own by default), each appointment of
 * today and tomorrow becomes a todo on its day — a series' occurrence on its own day, once. Ticking
 * it off leaves the appointment as it is. Deterministic, no AI. Server only.
 */
import { addCalendarTodo, getTodo, setTodoDue } from "@/lib/boards/store";
import { getPref, setPref } from "@/lib/prefs";
import { eventsBetween } from "./ir";
import { dayOf } from "./ir-shared";

/** The todos for today's and tomorrow's appointments (those not made yet). How many were made. */
export function calendarTodos(now = new Date()): number {
  const from = dayOf(now);
  const to = dayOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2));
  let added = 0;
  for (const e of eventsBetween(from, to)) {
    if (!e.calendar.todos || e.cancelled) continue;
    const day = (e.occurrence ?? e.start).slice(0, 10);
    // One that began before (several days long) had its todo on its first day.
    if (day < from || day >= to) continue;
    // Made for a todo (a proposal accepted): that todo is it — it's due then, no second one.
    if (e.todoId) {
      const t = getTodo(e.todoId);
      if (t && t.status === "open" && !t.due) setTodoDue(t.id, day);
      continue;
    }
    // Which appointment on which day: a series and its moved occurrences share one.
    const ref = `event:${e.seriesId ?? e.id}@${day}`;
    const text = e.allDay ? e.title : `${e.title} (${e.start.slice(11, 16)})`;
    if (addCalendarTodo({ text, due: day, ref, source: `Kalender „${e.calendar.name}“` })) added++;
  }
  return added;
}

/** The calendar todos when due (every 15 minutes, in each account with the Kalender installed). */
export async function calendarTodosWhenDue(): Promise<void> {
  if (!(await import("@/plugins/state")).isInstalled("calendar")) return;
  const last = getPref<number>("calendar:todos-at", 0);
  if (Date.now() - last < 15 * 60000) return;
  setPref("calendar:todos-at", Date.now());
  const n = calendarTodos();
  if (n) console.log(`[calendar] ${n} Todo${n === 1 ? "" : "s"} aus Terminen`);
}
