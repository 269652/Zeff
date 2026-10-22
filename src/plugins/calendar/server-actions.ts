"use server";

import { revalidateAll, type ActionState } from "@/app/action-helpers";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import type { SeriesScope } from "@/lib/calendar/ir-shared";

/** The Kalender app: its server actions (each answers an ActionState). */

/** Something in the calendar changed: pages are read again, and the Workspace's calendar database follows (its rows are these appointments). */
function changed(): void {
  revalidateAll();
  void import("@/plugins/workspace/calendar-database").then((m) => m.refreshCalendarDatabase()).catch(() => undefined);
}

/**
 * An appointment a todo proposes, dragged or resized in the calendar: its action gets the new start and length
 * (the todo and its other actions stay as they are). Nothing is entered in a calendar by this.
 */
export async function moveProposedEventAction(todoId: number, index: number, start: string, end: string): Promise<ActionState> {
  try {
    const minutes = Math.round((Date.parse(`${String(end).slice(0, 16)}:00`) - Date.parse(`${String(start).slice(0, 16)}:00`)) / 60000);
    if (!(minutes > 0)) return { ok: false, error: t("The end has to be after the start.") };
    const { moveCalendarOp } = await import("@/lib/boards/store");
    moveCalendarOp(Number(todoId), Number(index), String(start).slice(0, 16), minutes);
    changed();
    return { ok: true, message: t("Appointment moved — it is entered when you run the todo's action.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

const off = async () => (!(await import("@/plugins/state")).isInstalled("calendar") ? t("Calendar is not installed (Menu → Plugins).") : null);
const run = async (fn: () => Promise<string> | string): Promise<ActionState> => {
  try {
    const no = await off();
    if (no) return { ok: false, error: no };
    const message = await fn();
    // Today's and tomorrow's appointments as todos, right away (calendars set so) — not only every 15 minutes.
    try {
      (await import("@/lib/calendar/todos")).calendarTodos();
    } catch {
      // the next scheduled turn makes them
    }
    changed();
    return { ok: true, message };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
};

/** A calendar shown or hidden, recoloured, renamed (Zeff's own), counted as busy, offered for booking. */
export async function updateCalendarAction(id: number, patch: { name?: string; color?: string; visible?: boolean; busy?: boolean; book?: boolean; todos?: boolean }): Promise<ActionState> {
  return run(async () => {
    const c = (await import("@/lib/calendar/ir")).updateCalendar(Number(id), {
      name: typeof patch.name === "string" ? patch.name : undefined,
      color: typeof patch.color === "string" ? patch.color : undefined,
      visible: typeof patch.visible === "boolean" ? patch.visible : undefined,
      busy: typeof patch.busy === "boolean" ? patch.busy : undefined,
      book: typeof patch.book === "boolean" ? patch.book : undefined,
      todos: typeof patch.todos === "boolean" ? patch.todos : undefined,
    });
    return t("“{name}” saved.", { name: c.name });
  });
}

/** One of Zeff's own calendars, new. */
export async function createCalendarAction(name: string, color?: string): Promise<ActionState> {
  return run(async () => {
    const c = (await import("@/lib/calendar/ir")).createCalendar(String(name ?? ""), color ? String(color) : undefined);
    return t("“{name}” created.", { name: c.name });
  });
}

/** One of Zeff's own calendars, deleted with its appointments. */
export async function deleteCalendarAction(id: number): Promise<ActionState> {
  return run(async () => {
    (await import("@/lib/calendar/ir")).deleteCalendar(Number(id));
    return t("Calendar deleted.");
  });
}

/**
 * An appointment in one of Zeff's own calendars — new (no id) or changed; a series' occurrence
 * (`occurrence`: its day) changed alone, with the following ones, or all (`scope`). Dragging and
 * resizing in the app come here too (only the times change).
 */
export async function saveEventAction(v: {
  id?: number;
  calendarId: number;
  title: string;
  start: string;
  end: string;
  allDay?: boolean;
  location?: string;
  description?: string;
  /** The series' rule — null: not (any more) a series; left out: as it was. */
  recurrence?: unknown;
  occurrence?: string | null;
  scope?: SeriesScope;
}): Promise<ActionState> {
  return run(async () => {
    const ir = await import("@/lib/calendar/ir");
    const { parseRecurrence } = await import("@/lib/calendar/recurrence");
    const stamp = (s: unknown) => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(s.slice(0, 16)) ? s.slice(0, v.allDay ? 10 : 16) : "");
    const e = {
      title: String(v.title ?? "").trim(),
      start: stamp(v.start),
      end: stamp(v.end),
      allDay: !!v.allDay,
      location: String(v.location ?? ""),
      description: String(v.description ?? ""),
      ...(v.recurrence === undefined ? {} : { recurrence: parseRecurrence(v.recurrence) }),
    };
    if (!e.title) throw new Error(t("A title, please."));
    if (!e.start || !e.end || e.end < e.start || (!e.allDay && e.end === e.start)) throw new Error(t("A start and an end after it, please."));
    if (e.allDay && e.end === e.start) e.end = (await import("@/lib/calendar/recurrence")).addDays(e.start, 1);
    const occurrence = typeof v.occurrence === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.occurrence) ? v.occurrence : null;
    if (v.id && occurrence) {
      const scope: SeriesScope = v.scope === "one" || v.scope === "following" ? v.scope : "all";
      ir.updateOccurrence(Number(v.id), occurrence, e, scope);
      return scope === "one"
        ? t('"{title}" saved (this event).', { title: e.title })
        : scope === "following"
          ? t('"{title}" saved (this and following events).', { title: e.title })
          : t('"{title}" saved (all events).', { title: e.title });
    }
    if (v.id) {
      ir.updateEvent(Number(v.id), e);
      return t('"{title}" saved.', { title: e.title });
    }
    // No calendar of your own yet: the first one made for it.
    const calendarId = Number(v.calendarId) || ir.zeffCalendar().id;
    ir.addEvent(calendarId, e);
    return t('"{title}" added.', { title: e.title });
  });
}

/** An appointment of Zeff's own calendars deleted — a series' occurrence alone, with the following ones, or the whole series. */
export async function deleteEventAction(id: number, series?: { occurrence: string; scope: SeriesScope }): Promise<ActionState> {
  return run(async () => {
    const ir = await import("@/lib/calendar/ir");
    if (series && /^\d{4}-\d{2}-\d{2}$/.test(series.occurrence)) {
      const scope: SeriesScope = series.scope === "one" || series.scope === "following" ? series.scope : "all";
      ir.deleteOccurrence(Number(id), series.occurrence, scope);
      return scope === "one" ? t("Event deleted.") : scope === "following" ? t("This and following events deleted.") : t("Series deleted.");
    }
    ir.deleteEvent(Number(id));
    return t("Event deleted.");
  });
}

/** Google Calendar's account, how many weeks ahead it reads and how many months back. */
export async function saveGoogleCalendarSettingsAction(v: { account: string; weeks: number; pastMonths?: number }): Promise<ActionState> {
  return run(async () => {
    const { setPref } = await import("@/lib/prefs");
    const account = String(v.account ?? "0").trim() || "0";
    const weeks = Math.max(1, Math.min(12, Math.round(Number(v.weeks) || 5)));
    const pastMonths = Math.max(0, Math.min(24, Math.round(Number(v.pastMonths ?? 3))));
    setPref("plugin:google-calendar", { account, weeks, pastMonths });
    return t("Saved.");
  });
}

/** "Jetzt syncen": the calendars' sources now (Google's sync; Outlook's is read in when its own sync brought something). */
export async function syncCalendarsAction(range?: { from: string; to: string }): Promise<ActionState> {
  const { isInstalled } = await import("@/plugins/state");
  if (!isInstalled("google-calendar")) return { ok: false, error: t("Google Calendar is not installed (Menu → Plugins).") };
  // The days shown (a month gone by): read with the window of the settings.
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (range && day.test(String(range.from)) && day.test(String(range.to))) {
    // (On the sync host when there is one — the syncs run there.)
    const { delegates } = await import("@/lib/host/role");
    const asked = { from: range.from, to: range.to };
    const r = delegates()
      ? await (await import("@/lib/host/client")).callHost<{ ok: boolean; message: string }>("gcal.range", asked, 10 * 60000).catch((e: unknown) => ({ ok: false, message: e instanceof Error ? e.message : String(e) }))
      : await (await import("@/plugins/google-calendar/sync")).syncGoogleCalendar({ range: asked });
    changed();
    return r.ok ? { ok: true, message: `Google Calendar: ${r.message}` } : { ok: false, error: r.message };
  }
  const { syncAndWait } = await import("@/lib/sync/registry");
  const r = await syncAndWait("gcalendar");
  changed();
  return r.lastOk ? { ok: true, message: `Google Calendar: ${r.lastMessage ?? ""}` } : { ok: false, error: r.lastMessage ?? t("Failed.") };
}

/**
 * A proposed appointment accepted in the calendar (Zeff's own calendar: entered now) — only that
 * action of its todo; it leaves the todo, noted on it. `title`: the one shown (the todo's actions may
 * have changed meanwhile).
 */
export async function acceptProposedEventAction(todoId: number, index: number, title: string): Promise<ActionState> {
  return run(async () => {
    const { getTodo, addTodoUserNote } = await import("@/lib/boards/store");
    const todo = getTodo(Number(todoId));
    const op = todo?.ops[Number(index)];
    if (!todo || !op || op.type !== "calendar-entry" || op.title !== String(title)) throw new Error(t("This proposal isn't on the todo any more — reload the calendar."));
    const { runCalendarEntry } = await import("./run");
    const r = await runCalendarEntry(op, { todo, note: () => {} });
    // Taken off — the others stay as they were proposed (not as if you'd edited them).
    const { getDb, schema } = await import("@/db");
    const { eq } = await import("drizzle-orm");
    getDb().update(schema.todos).set({ ops: JSON.stringify(todo.ops.filter((_, i) => i !== Number(index))) }).where(eq(schema.todos.id, todo.id)).run();
    if (r.todoNote) addTodoUserNote(todo.id, `✓ ${r.todoNote}`);
    return r.what;
  });
}

/** What the calendar app shows around a day (the Workspace's calendar view asks for it as it moves). */
export async function calendarDataAction(view: string, day: string): Promise<{ ok: true; data: import("./view-data").CalendarData } | { ok: false; error: string }> {
  try {
    const { isInstalled } = await import("@/plugins/state");
    if (!isInstalled("calendar")) return { ok: false, error: t("The Calendar plugin is not installed (Menu → Plugins).") };
    return { ok: true, data: await (await import("./view-data")).calendarViewData(view, day) };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}
