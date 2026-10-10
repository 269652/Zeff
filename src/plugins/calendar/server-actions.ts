"use server";

import { revalidateAll, type ActionState } from "@/app/action-helpers";
import { errorMessage } from "@/lib/errors";
import type { SeriesScope } from "@/lib/calendar/ir-shared";

/** The Kalender app: its server actions (each answers an ActionState). */

const off = async () => (!(await import("@/plugins/state")).isInstalled("calendar") ? "Der Kalender ist nicht installiert (Menü → Plugins)." : null);
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
    revalidateAll();
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
    return `„${c.name}“ gespeichert.`;
  });
}

/** One of Zeff's own calendars, new. */
export async function createCalendarAction(name: string, color?: string): Promise<ActionState> {
  return run(async () => `„${(await import("@/lib/calendar/ir")).createCalendar(String(name ?? ""), color ? String(color) : undefined).name}“ angelegt.`);
}

/** One of Zeff's own calendars, deleted with its appointments. */
export async function deleteCalendarAction(id: number): Promise<ActionState> {
  return run(async () => {
    (await import("@/lib/calendar/ir")).deleteCalendar(Number(id));
    return "Kalender gelöscht.";
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
    if (!e.title) throw new Error("A title, please.");
    if (!e.start || !e.end || e.end < e.start || (!e.allDay && e.end === e.start)) throw new Error("A start and an end after it, please.");
    if (e.allDay && e.end === e.start) e.end = (await import("@/lib/calendar/recurrence")).addDays(e.start, 1);
    const occurrence = typeof v.occurrence === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.occurrence) ? v.occurrence : null;
    if (v.id && occurrence) {
      const scope: SeriesScope = v.scope === "one" || v.scope === "following" ? v.scope : "all";
      ir.updateOccurrence(Number(v.id), occurrence, e, scope);
      return `"${e.title}" saved${scope === "one" ? " (this event)" : scope === "following" ? " (this and following events)" : " (all events)"}.`;
    }
    if (v.id) {
      ir.updateEvent(Number(v.id), e);
      return `"${e.title}" saved.`;
    }
    // No calendar of your own yet: the first one made for it.
    const calendarId = Number(v.calendarId) || ir.zeffCalendar().id;
    ir.addEvent(calendarId, e);
    return `"${e.title}" added.`;
  });
}

/** An appointment of Zeff's own calendars deleted — a series' occurrence alone, with the following ones, or the whole series. */
export async function deleteEventAction(id: number, series?: { occurrence: string; scope: SeriesScope }): Promise<ActionState> {
  return run(async () => {
    const ir = await import("@/lib/calendar/ir");
    if (series && /^\d{4}-\d{2}-\d{2}$/.test(series.occurrence)) {
      const scope: SeriesScope = series.scope === "one" || series.scope === "following" ? series.scope : "all";
      ir.deleteOccurrence(Number(id), series.occurrence, scope);
      return scope === "one" ? "Event deleted." : scope === "following" ? "This and following events deleted." : "Series deleted.";
    }
    ir.deleteEvent(Number(id));
    return "Event deleted.";
  });
}

/** Google Calendar's account and how many weeks it reads. */
export async function saveGoogleCalendarSettingsAction(v: { account: string; weeks: number }): Promise<ActionState> {
  return run(async () => {
    const { setPref } = await import("@/lib/prefs");
    const account = String(v.account ?? "0").trim() || "0";
    const weeks = Math.max(1, Math.min(12, Math.round(Number(v.weeks) || 5)));
    setPref("plugin:google-calendar", { account, weeks });
    return "Gespeichert.";
  });
}

/** "Jetzt syncen": the calendars' sources now (Google's sync; Outlook's is read in when its own sync brought something). */
export async function syncCalendarsAction(): Promise<ActionState> {
  const { isInstalled } = await import("@/plugins/state");
  if (!isInstalled("google-calendar")) return { ok: false, error: "Google Calendar ist nicht installiert (Menü → Plugins)." };
  const { syncAndWait } = await import("@/lib/sync/registry");
  const r = await syncAndWait("gcalendar");
  revalidateAll();
  return r.lastOk ? { ok: true, message: `Google Calendar: ${r.lastMessage ?? ""}` } : { ok: false, error: r.lastMessage ?? "Fehlgeschlagen." };
}

/**
 * A proposed appointment accepted in the calendar (Zeff's own calendar: entered now) — only that
 * action of its todo; it leaves the todo, noted on it. `title`: the one shown (the todo's actions may
 * have changed meanwhile).
 */
export async function acceptProposedEventAction(todoId: number, index: number, title: string): Promise<ActionState> {
  return run(async () => {
    const { getTodo, addTodoUserNote } = await import("@/lib/boards/store");
    const t = getTodo(Number(todoId));
    const op = t?.ops[Number(index)];
    if (!t || !op || op.type !== "calendar-entry" || op.title !== String(title)) throw new Error("This proposal isn't on the todo any more — reload the calendar.");
    const { runCalendarEntry } = await import("./run");
    const r = await runCalendarEntry(op, { todo: t, note: () => {} });
    // Taken off — the others stay as they were proposed (not as if you'd edited them).
    const { getDb, schema } = await import("@/db");
    const { eq } = await import("drizzle-orm");
    getDb().update(schema.todos).set({ ops: JSON.stringify(t.ops.filter((_, i) => i !== Number(index))) }).where(eq(schema.todos.id, t.id)).run();
    if (r.todoNote) addTodoUserNote(t.id, `✓ ${r.todoNote}`);
    return r.what;
  });
}
