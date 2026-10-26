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
    // (Not awaited: the AI may judge new appointments first — the next scheduled turn makes them if this one fails.)
    void (await import("@/lib/calendar/todos")).calendarTodos().catch(() => {});
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
 * resizing in the app come here too (only the times change). In a Google calendar you may write to
 * (with Google Calendar's write access): made or changed there through Google's API — no series,
 * `attendees` invited — and read back at once.
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
  /** A Google calendar's event: its guests (mail addresses). */
  attendees?: string[];
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
    // A Google calendar's: written there (the copy here follows from Google).
    const before = v.id ? ir.eventById(Number(v.id)) : null;
    if (v.id && !before) throw new Error(t("This event isn't there any more — reload the calendar."));
    const cal = before?.calendar ?? (v.calendarId ? ir.listCalendars().find((c) => c.id === Number(v.calendarId)) : undefined);
    if (cal?.source === "google") return saveGoogleEvent(cal.key, before?.key ?? null, { ...e, attendees: Array.isArray(v.attendees) ? v.attendees.map(String) : undefined });
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

/** The Google calendar's id of Zeff's calendar ("google:<id>"), and an event's id from Zeff's key for it. */
async function googleIds(calendarKey: string, eventKey: string | null): Promise<{ calendarId: string; eventId: string | null }> {
  const calendarId = calendarKey.replace(/^google:/, "");
  if (!eventKey) return { calendarId, eventId: null };
  const ids = (await import("@/lib/google/calendar-write")).gcalIdsOf(eventKey);
  if (!ids) throw new Error(t("Zeff doesn't know this event's id in Google — change it in Google Calendar."));
  return { calendarId, eventId: ids.eventId };
}

/** An event of a Google calendar made (no key) or changed through Google's API — what it says. */
async function saveGoogleEvent(calendarKey: string, eventKey: string | null, e: { title: string; start: string; end: string; allDay: boolean; location: string; description: string; attendees?: string[] }): Promise<string> {
  const gw = await import("@/lib/google/calendar-write");
  const { journalGoogleWrite } = await import("@/lib/google/journal");
  const { calendarId, eventId } = await googleIds(calendarKey, eventKey);
  const fields = { title: e.title, start: e.start, end: e.end, allDay: e.allDay, location: e.location, description: e.description, ...(e.attendees ? { attendees: e.attendees } : {}) };
  if (eventId) {
    await gw.patchGcalEvent(calendarId, eventId, fields);
    journalGoogleWrite({ kind: "calendar.changed", source: "gcalendar", sourceRef: `${eventId}:${Date.now()}`, title: e.title, summary: `${e.start} – ${e.end}` });
    return t('"{title}" saved in Google Calendar.', { title: e.title });
  }
  const r = await gw.insertGcalEvent(calendarId, fields);
  journalGoogleWrite({ kind: "calendar.created", source: "gcalendar", sourceRef: r.id, title: e.title, summary: `${e.start} – ${e.end}`, url: r.htmlLink });
  return t('"{title}" added to Google Calendar.', { title: e.title });
}

/** Your answer to an invitation in a Google calendar — yes, maybe, no — sent to its organiser through Google's API. */
export async function respondEventAction(id: number, response: "accepted" | "tentative" | "declined"): Promise<ActionState> {
  return run(async () => {
    const ir = await import("@/lib/calendar/ir");
    const ev = ir.eventById(Number(id));
    if (!ev || ev.calendar.source !== "google") throw new Error(t("Only invitations in a Google calendar can be answered here."));
    const { calendarId, eventId } = await googleIds(ev.calendar.key, ev.key);
    const answer = response === "accepted" || response === "declined" || response === "tentative" ? response : null;
    if (!answer) throw new Error(t("An answer is accepted, declined or tentative."));
    await (await import("@/lib/google/calendar-write")).respondGcalEvent(calendarId, eventId!, answer);
    const { journalGoogleWrite } = await import("@/lib/google/journal");
    journalGoogleWrite({ kind: "calendar.response", source: "gcalendar", sourceRef: `${eventId}:${answer}:${Date.now()}`, title: ev.title, summary: answer });
    return answer === "accepted" ? t("Accepted — “{title}”.", { title: ev.title }) : answer === "declined" ? t("Declined — “{title}”.", { title: ev.title }) : t("Answered maybe — “{title}”.", { title: ev.title });
  });
}

/** An appointment of Zeff's own calendars deleted — a series' occurrence alone, with the following ones, or the whole series. */
export async function deleteEventAction(id: number, series?: { occurrence: string; scope: SeriesScope }): Promise<ActionState> {
  return run(async () => {
    const ir = await import("@/lib/calendar/ir");
    if (ir.eventById(Number(id))?.calendar.source === "google") throw new Error(t("Zeff never deletes events in Google Calendar — delete it there if you must."));
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
 * A proposed appointment accepted in the calendar (Zeff's own calendar: entered now; Google Calendar's, with its write access:
 * entered there through Google's API) — only that action of its todo; it leaves the todo, noted on it. `title`: the one shown
 * (the todo's actions may have changed meanwhile).
 */
export async function acceptProposedEventAction(todoId: number, index: number, title: string): Promise<ActionState> {
  return run(async () => {
    const { getTodo, addTodoUserNote } = await import("@/lib/boards/store");
    const todo = getTodo(Number(todoId));
    const op = todo?.ops[Number(index)];
    // Google Calendar's (with its write access): entered there through Google's API, on this click.
    if (todo && op?.type === "gcal-event" && op.title === String(title)) return (await import("@/plugins/google-calendar/run")).runGcalEventOnTodo(todo.id, Number(index)).then((r) => r.what);
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
