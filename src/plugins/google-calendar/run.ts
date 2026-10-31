/**
 * Google Calendar's action run through Google's API — only from its own button (your click on a todo's proposed appointment:
 * "Add to Google Calendar", in the todo or the calendar), never by the todo's "Run", a worker or an agent: those leave it as
 * Google's form, filled in, for you to save. Entered in your main calendar. Server only.
 */
import type { TodoOp } from "@/lib/todos/shared";
import { plusMinutes } from "@/lib/calendar/ir-shared";
import { formatDate, formatTime } from "@/lib/format";
import { gcalCanWrite, insertGcalEvent } from "@/lib/google/calendar-write";
import { journalGoogleWrite } from "@/lib/google/journal";
import { t } from "@/lib/i18n/server";
import type { ActionResult } from "../actions/run-types";

type GcalOp = Extract<TodoOp, { type: "gcal-event" }>;

/** The appointment entered in your main Google calendar. */
export async function runGcalEvent(op: GcalOp, refs: string[] = []): Promise<ActionResult> {
  const r = await insertGcalEvent("primary", { title: op.title, start: op.start, end: plusMinutes(op.start, op.minutes), description: op.body });
  const at = `${formatDate(op.start)}, ${formatTime(op.start)}`;
  journalGoogleWrite({ kind: "calendar.created", source: "gcalendar", sourceRef: r.id, title: op.title, summary: at, url: r.htmlLink, refs });
  const what = t("Event “{title}” on {at} added to Google Calendar", { title: op.title, at });
  return { what, todoNote: what };
}

/** A todo's appointment — your click: entered, then off the todo and noted there. */
export async function runGcalEventOnTodo(todoId: number, index: number): Promise<{ what: string; settled: boolean }> {
  const { clickedOp, settleClickedOp } = await import("../actions/clicked");
  const { todo, op } = await clickedOp(todoId, index, "gcal-event");
  if (!gcalCanWrite()) throw new Error(t("Google was only asked for read access to the calendar. Allow writing to Google Calendar on the Connections page and sign in to Google again."));
  const r = await runGcalEvent(op, [`todo:${todo.id}`]);
  return { what: r.what, settled: await settleClickedOp(todo, op, r.what) };
}
