/** The Kalender app's action, run: the appointment entered in your Zeff calendar (by name; else the first), with its todo. Server only. */
import type { TodoOp } from "@/lib/todos/shared";
import { addEvent, zeffCalendar } from "@/lib/calendar/ir";
import { plusMinutes } from "@/lib/calendar/ir-shared";
import { formatDate, formatTime } from "@/lib/format";
import { t } from "@/lib/i18n/server";
import type { ActionContext, ActionResult } from "../actions/run-types";

export async function runCalendarEntry(op: Extract<TodoOp, { type: "calendar-entry" }>, ctx: ActionContext): Promise<ActionResult> {
  const cal = zeffCalendar(op.calendar);
  const e = addEvent(cal.id, { title: op.title, start: op.start, end: plusMinutes(op.start, op.minutes), description: op.body, todoId: ctx.todo.id });
  const at = `${formatDate(e.start)}, ${formatTime(e.start)}`;
  return {
    what: t("Event “{title}” on {at} added to {calendar}", { title: e.title, at, calendar: cal.name }),
    todoNote: `Event in the calendar (${cal.name}): ${at} — “${e.title}”.`,
  };
}
