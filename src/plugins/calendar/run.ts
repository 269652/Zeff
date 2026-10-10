/** The Kalender app's action, run: the appointment entered in your Zeff calendar (by name; else the first), with its todo. Server only. */
import type { TodoOp } from "@/lib/boards/shared";
import { addEvent, zeffCalendar } from "@/lib/calendar/ir";
import { plusMinutes } from "@/lib/calendar/ir-shared";
import type { ActionContext, ActionResult } from "../actions/run-types";

export async function runCalendarEntry(op: Extract<TodoOp, { type: "calendar-entry" }>, ctx: ActionContext): Promise<ActionResult> {
  const cal = zeffCalendar(op.calendar);
  const e = addEvent(cal.id, { title: op.title, start: op.start, end: plusMinutes(op.start, op.minutes), description: op.body, todoId: ctx.todo.id });
  const at = new Date(`${e.start}:00`).toLocaleString("de-DE", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return { what: `Termin „${e.title}“ am ${at} in ${cal.name} eingetragen`, todoNote: `Termin im Kalender (${cal.name}): ${at} — „${e.title}“.` };
}
