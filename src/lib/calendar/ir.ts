/**
 * Zeff's calendar model (the "IR"): every calendar in one shape — Zeff's own, Google Calendar's,
 * Outlook's — each source's adapter writing into it (Google's sync, Outlook's inbox read in again
 * whenever it changed). The Kalender app, free times for appointment proposals and booking meetings
 * read only this; Outlook's own record rides along (raw), so its features see it unchanged.
 * Server only.
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, gte, isNotNull, isNull, lt, or } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getPref, setPref } from "@/lib/prefs";
import { isInstalled } from "@/plugins/state";
import { inboxWrittenAt, readInbox } from "./inbox";
import { CALENDAR_COLORS, type CalendarEventView, type CalendarSourceKind, type CalendarView, type SeriesScope } from "./ir-shared";
import { addDays, expand, occurrenceDays, onDay, parseRecurrence, type Recurrence } from "./recurrence";
import type { GraphEvent } from "./meetings";

const { calendars, calendarEvents } = schema;

/** An appointment as an adapter hands it over. */
export type EventInput = {
  key: string;
  title: string;
  start: string;
  end: string;
  allDay?: boolean;
  location?: string;
  description?: string;
  showAs?: string;
  cancelled?: boolean;
  response?: string | null;
  private?: boolean;
  online?: boolean;
  organizer?: string;
  attendees?: string[];
  url?: string;
  raw?: string | null;
  todoId?: number | null;
  /** A series (Zeff's own calendars): its rule. */
  recurrence?: Recurrence | null;
  exdates?: string[];
  seriesId?: number | null;
};

const now = () => new Date().toISOString();
const toView = (c: typeof calendars.$inferSelect): CalendarView => ({ id: c.id, key: c.key, source: c.source, name: c.name, color: c.color, visible: c.visible, busy: c.busy, book: c.book });
const eventView = (e: typeof calendarEvents.$inferSelect): CalendarEventView => ({
  id: e.id,
  calendarId: e.calendarId,
  key: e.key,
  title: e.title,
  start: e.start,
  end: e.end,
  allDay: e.allDay,
  location: e.location,
  description: e.description,
  showAs: e.showAs,
  cancelled: e.cancelled,
  response: e.response,
  private: e.private,
  online: e.online,
  organizer: e.organizer,
  attendees: (() => {
    try {
      return JSON.parse(e.attendees) as string[];
    } catch {
      return [];
    }
  })(),
  url: e.url,
  todoId: e.todoId,
  recurrence: parseRecurrence(e.recurrence),
  occurrence: null,
  seriesId: e.seriesId,
});
const exdatesOf = (e: typeof calendarEvents.$inferSelect): string[] => {
  try {
    return JSON.parse(e.exdates) as string[];
  } catch {
    return [];
  }
};

/**
 * A source's calendar, made the first time it's seen — its name follows the source; colour, shown,
 * busy and booking stay as you set them.
 */
export function ensureCalendar(key: string, init: { source: CalendarSourceKind; name: string; color?: string; visible?: boolean; busy?: boolean; book?: boolean }): CalendarView {
  const db = getDb();
  const have = db.select().from(calendars).where(eq(calendars.key, key)).get();
  if (have) {
    if (init.source !== "zeff" && init.name && have.name !== init.name) db.update(calendars).set({ name: init.name, updatedAt: now() }).where(eq(calendars.id, have.id)).run();
    return toView({ ...have, name: init.source !== "zeff" && init.name ? init.name : have.name });
  }
  const count = db.select({ id: calendars.id }).from(calendars).all().length;
  const row = db
    .insert(calendars)
    .values({
      key,
      source: init.source,
      name: init.name || "Kalender",
      color: init.color || CALENDAR_COLORS[count % CALENDAR_COLORS.length],
      visible: init.visible ?? true,
      busy: init.busy ?? true,
      book: init.book ?? false,
      createdAt: now(),
      updatedAt: now(),
    })
    .returning()
    .get();
  return toView(row);
}

/** Every calendar (Outlook's read in again first, if it changed): Zeff's own first, then Google's, then Outlook's. */
export function listCalendars(): CalendarView[] {
  syncOutlook();
  const order: Record<CalendarSourceKind, number> = { zeff: 0, google: 1, outlook: 2 };
  return getDb()
    .select()
    .from(calendars)
    .orderBy(asc(calendars.id))
    .all()
    .map(toView)
    .sort((a, b) => order[a.source] - order[b.source]);
}

export function updateCalendar(id: number, patch: { name?: string; color?: string; visible?: boolean; busy?: boolean; book?: boolean }): CalendarView {
  const db = getDb();
  const c = db.select().from(calendars).where(eq(calendars.id, id)).get();
  if (!c) throw new Error("Unbekannter Kalender.");
  const set: Partial<typeof calendars.$inferInsert> = { updatedAt: now() };
  if (patch.name !== undefined && c.source === "zeff") set.name = patch.name.trim().slice(0, 80) || c.name;
  if (patch.color && /^#[0-9a-f]{6}$/i.test(patch.color)) set.color = patch.color;
  if (typeof patch.visible === "boolean") set.visible = patch.visible;
  if (typeof patch.busy === "boolean") set.busy = patch.busy;
  if (typeof patch.book === "boolean") set.book = patch.book;
  return toView(db.update(calendars).set(set).where(eq(calendars.id, id)).returning().get());
}

/** One of Zeff's own calendars. */
export function createCalendar(name: string, color?: string): CalendarView {
  const n = name.trim().slice(0, 80);
  if (!n) throw new Error("Ein Name, bitte.");
  return ensureCalendar(`zeff:${randomUUID()}`, { source: "zeff", name: n, color });
}

/** One of Zeff's own calendars, with its appointments (a source's comes back with its next sync). */
export function deleteCalendar(id: number): void {
  const db = getDb();
  const c = db.select().from(calendars).where(eq(calendars.id, id)).get();
  if (!c) return;
  if (c.source !== "zeff") throw new Error("Nur Zeffs eigene Kalender lassen sich löschen — die anderen ausblenden.");
  db.transaction((tx) => {
    tx.delete(calendarEvents).where(eq(calendarEvents.calendarId, id)).run();
    tx.delete(calendars).where(eq(calendars.id, id)).run();
  });
}

const row = (calendarId: number, e: EventInput): typeof calendarEvents.$inferInsert => ({
  calendarId,
  key: e.key,
  title: e.title.slice(0, 300) || "(ohne Titel)",
  start: e.start,
  end: e.end || e.start,
  allDay: !!e.allDay,
  location: (e.location ?? "").slice(0, 300),
  description: (e.description ?? "").slice(0, 4000),
  showAs: e.showAs || "busy",
  cancelled: !!e.cancelled,
  response: e.response ?? null,
  private: !!e.private,
  online: !!e.online,
  organizer: (e.organizer ?? "").slice(0, 200),
  attendees: JSON.stringify((e.attendees ?? []).slice(0, 100)),
  url: (e.url ?? "").slice(0, 2000),
  raw: e.raw ?? null,
  todoId: e.todoId ?? null,
  recurrence: e.recurrence ? JSON.stringify(e.recurrence) : null,
  exdates: JSON.stringify([...new Set(e.exdates ?? [])].sort()),
  seriesId: e.seriesId ?? null,
  updatedAt: now(),
});

/**
 * A source's appointments, as it now has them: those of the range read (all, without one) replaced —
 * so what was moved or deleted there goes here too. How many.
 */
export function replaceEvents(calendarId: number, events: EventInput[], range?: { from: string; to: string }): number {
  const db = getDb();
  db.transaction((tx) => {
    tx.delete(calendarEvents)
      .where(range ? and(eq(calendarEvents.calendarId, calendarId), gte(calendarEvents.start, range.from), lt(calendarEvents.start, range.to)) : eq(calendarEvents.calendarId, calendarId))
      .run();
    const seen = new Set<string>();
    for (const e of events) {
      if (seen.has(e.key)) continue;
      seen.add(e.key);
      tx.insert(calendarEvents)
        .values(row(calendarId, e))
        .onConflictDoUpdate({ target: [calendarEvents.calendarId, calendarEvents.key], set: { ...row(calendarId, e) } })
        .run();
    }
  });
  return events.length;
}

/**
 * The appointments between two local times (overlapping them), of the calendars asked for (shown,
 * busy, for booking) — each with its calendar; a series' occurrences each on their own (its id,
 * their day as `occurrence`).
 */
export function eventsBetween(from: string, to: string, only: { visible?: boolean; busy?: boolean; book?: boolean } = {}): (CalendarEventView & { calendar: CalendarView })[] {
  const cals = new Map(listCalendars().map((c) => [c.id, c]));
  return getDb()
    .select()
    .from(calendarEvents)
    // Single ones overlapping the range; series begun before its end (expanded below).
    .where(or(and(isNull(calendarEvents.recurrence), lt(calendarEvents.start, to), gt(calendarEvents.end, from)), and(isNotNull(calendarEvents.recurrence), lt(calendarEvents.start, to))))
    .orderBy(asc(calendarEvents.start))
    .all()
    .flatMap((e) => {
      const c = cals.get(e.calendarId);
      if (!c || (only.visible && !c.visible) || (only.busy && !c.busy) || (only.book && !c.book)) return [];
      const view = eventView(e);
      if (!view.recurrence) return [{ ...view, calendar: c }];
      return expand(view, view.recurrence, exdatesOf(e), from, to).map((o) => ({ ...view, start: o.start, end: o.end, occurrence: o.occurrence, key: `${e.key}#${o.occurrence}`, calendar: c }));
    })
    .sort((a, b) => a.start.localeCompare(b.start));
}

/** An appointment in one of Zeff's own calendars. */
export function addEvent(calendarId: number, e: Omit<EventInput, "key">): CalendarEventView {
  const c = getDb().select().from(calendars).where(eq(calendars.id, calendarId)).get();
  if (!c || c.source !== "zeff") throw new Error("Termine lassen sich nur in Zeffs eigenen Kalendern anlegen.");
  if (!e.title.trim() || !e.start) throw new Error("Ein Titel und ein Beginn, bitte.");
  return eventView(getDb().insert(calendarEvents).values(row(calendarId, { ...e, key: randomUUID() })).returning().get());
}

/** An appointment of Zeff's own calendars, changed or deleted. */
export function updateEvent(id: number, patch: Partial<Omit<EventInput, "key">>): CalendarEventView {
  const db = getDb();
  const e = db.select().from(calendarEvents).where(eq(calendarEvents.id, id)).get();
  const c = e && db.select().from(calendars).where(eq(calendars.id, e.calendarId)).get();
  if (!e || !c || c.source !== "zeff") throw new Error("Nur Termine in Zeffs eigenen Kalendern lassen sich ändern.");
  // A series keeps its left-out occurrences.
  const next = row(e.calendarId, { ...eventView(e), exdates: exdatesOf(e), ...patch, key: e.key, raw: e.raw, todoId: patch.todoId ?? e.todoId });
  return eventView(db.update(calendarEvents).set(next).where(eq(calendarEvents.id, id)).returning().get());
}

export function deleteEvent(id: number): void {
  const db = getDb();
  const e = db.select().from(calendarEvents).where(eq(calendarEvents.id, id)).get();
  const c = e && db.select().from(calendars).where(eq(calendars.id, e.calendarId)).get();
  if (!e || !c || c.source !== "zeff") throw new Error("Nur Termine in Zeffs eigenen Kalendern lassen sich löschen.");
  db.transaction((tx) => {
    // A series: with the occurrences changed on their own.
    tx.delete(calendarEvents).where(eq(calendarEvents.seriesId, id)).run();
    tx.delete(calendarEvents).where(eq(calendarEvents.id, id)).run();
  });
}

// ---------------------------------------------------------------------------
// Series (Zeff's own calendars): one occurrence, it and the following, or all
// ---------------------------------------------------------------------------

/** A series' first appointment (its row) — of Zeff's own calendars, else an error. */
function seriesRow(id: number) {
  const db = getDb();
  const e = db.select().from(calendarEvents).where(eq(calendarEvents.id, id)).get();
  const c = e && db.select().from(calendars).where(eq(calendars.id, e.calendarId)).get();
  if (!e || !c || c.source !== "zeff") throw new Error("Only appointments in Zeff's own calendars can be changed.");
  const rule = parseRecurrence(e.recurrence);
  if (!rule) throw new Error("That appointment isn't a series.");
  return { e, rule };
}

const minutesBetween = (a: string, b: string) => Math.round((new Date(`${b.length === 10 ? `${b}T00:00` : b.slice(0, 16)}:00`).getTime() - new Date(`${a.length === 10 ? `${a}T00:00` : a.slice(0, 16)}:00`).getTime()) / 60000);
const plus = (s: string, minutes: number) => {
  const d = new Date(`${s.length === 10 ? `${s}T00:00` : s.slice(0, 16)}:00`);
  d.setMinutes(d.getMinutes() + minutes);
  const two = (n: number) => String(n).padStart(2, "0");
  const day = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
  return s.length === 10 ? day : `${day}T${two(d.getHours())}:${two(d.getMinutes())}`;
};

/** A rule ending before a day: until the day before — its count turned into that (the occurrences before it). */
function endBefore(rule: Recurrence, day: string): Recurrence {
  const { count: _count, ...rest } = rule;
  return { ...rest, until: addDays(day, -1) };
}

/**
 * A change to a series' occurrence (the day it falls on): `one` — it alone (left out of the series,
 * an appointment of its own instead); `following` — it and the rest (the series ends before it, a
 * new one begins with the change); `all` — the whole series (a moved time moves every occurrence).
 */
export function updateOccurrence(id: number, occurrence: string, patch: Partial<Omit<EventInput, "key">>, scope: SeriesScope): CalendarEventView {
  const db = getDb();
  const { e, rule } = seriesRow(id);
  const base = eventView(e);
  // This occurrence as it was.
  const was = { start: onDay(base.start, occurrence), end: plus(onDay(base.start, occurrence), minutesBetween(base.start, base.end)) };
  const next = { ...base, ...was, ...patch };
  const firstDay = base.start.slice(0, 10);
  if (scope === "all" || (scope === "following" && occurrence === firstDay)) {
    // The whole series: moved by as much as this occurrence was, its length as now.
    const shift = minutesBetween(was.start, next.start);
    const start = plus(base.start, shift);
    const end = plus(start, minutesBetween(next.start, next.end));
    let r = patch.recurrence === undefined ? rule : patch.recurrence;
    // Weekly on set weekdays, moved to another day: the weekdays move along.
    const days = Math.round(shift / 1440);
    if (r && r.freq === "weekly" && r.byDay?.length && patch.recurrence === undefined && days % 7 !== 0) r = { ...r, byDay: [...new Set(r.byDay.map((d) => (((d + days) % 7) + 7) % 7))].sort() };
    const exdates = exdatesOf(e).map((x) => addDays(x, days));
    const set = row(e.calendarId, { ...next, key: e.key, start, end, recurrence: r, exdates, raw: e.raw, todoId: e.todoId, seriesId: null });
    return eventView(db.update(calendarEvents).set(set).where(eq(calendarEvents.id, id)).returning().get());
  }
  if (scope === "one") {
    // Left out of the series; the changed one an appointment of its own (remembering its series).
    return db.transaction((tx) => {
      tx.update(calendarEvents).set({ exdates: JSON.stringify([...new Set([...exdatesOf(e), occurrence])].sort()), updatedAt: now() }).where(eq(calendarEvents.id, id)).run();
      return eventView(tx.insert(calendarEvents).values(row(e.calendarId, { ...next, key: randomUUID(), recurrence: null, exdates: [], seriesId: id, todoId: e.todoId })).returning().get());
    });
  }
  // It and the following: the series ends before it; a new one starts with the change (the rest of the count, its later exceptions).
  return db.transaction((tx) => {
    const before = occurrenceDays(base.start, rule, occurrence).length;
    const r = patch.recurrence === undefined ? rule : patch.recurrence;
    const rest = r && rule.count && patch.recurrence === undefined ? { ...r, count: Math.max(1, rule.count - before) } : r;
    const later = exdatesOf(e).filter((x) => x > occurrence);
    tx.update(calendarEvents)
      .set({ recurrence: JSON.stringify(endBefore(rule, occurrence)), exdates: JSON.stringify(exdatesOf(e).filter((x) => x < occurrence)), updatedAt: now() })
      .where(eq(calendarEvents.id, id))
      .run();
    return eventView(tx.insert(calendarEvents).values(row(e.calendarId, { ...next, key: randomUUID(), recurrence: rest, exdates: later, seriesId: null, todoId: e.todoId })).returning().get());
  });
}

/** A series' occurrence deleted: it alone, it and the following, or the whole series. */
export function deleteOccurrence(id: number, occurrence: string, scope: SeriesScope): void {
  const { e, rule } = seriesRow(id);
  if (scope === "all" || (scope === "following" && occurrence === e.start.slice(0, 10))) return deleteEvent(id);
  const set =
    scope === "one"
      ? { exdates: JSON.stringify([...new Set([...exdatesOf(e), occurrence])].sort()) }
      : { recurrence: JSON.stringify(endBefore(rule, occurrence)), exdates: JSON.stringify(exdatesOf(e).filter((x) => x < occurrence)) };
  getDb().update(calendarEvents).set({ ...set, updatedAt: now() }).where(eq(calendarEvents.id, id)).run();
}

/** Zeff's own calendar by name (else the first of them — made when there is none). */
export function zeffCalendar(name = ""): CalendarView {
  const own = listCalendars().filter((c) => c.source === "zeff");
  return own.find((c) => c.name.toLowerCase() === name.trim().toLowerCase()) ?? own[0] ?? createCalendar("Mein Kalender");
}

// ---------------------------------------------------------------------------
// Outlook's adapter: its inbox (the calendar sync's) read in whenever it changed
// ---------------------------------------------------------------------------

/** Outlook's event in the model — its own record kept (raw) for what reads it the Outlook way. */
export function fromGraph(e: GraphEvent): EventInput {
  const day = (s: string) => s.slice(0, 10);
  return {
    key: `${e.iCalUId || e.id}@${e.start.dateTime.slice(0, 16)}`,
    title: e.subject ?? "",
    start: e.isAllDay ? day(e.start.dateTime) : e.start.dateTime.slice(0, 16),
    end: e.isAllDay ? day(e.end.dateTime) : e.end.dateTime.slice(0, 16),
    allDay: !!e.isAllDay,
    location: e.location?.displayName ?? "",
    showAs: e.showAs || "busy",
    cancelled: !!e.isCancelled,
    response: e.responseStatus?.response ?? null,
    private: e.sensitivity === "private" || e.sensitivity === "confidential",
    online: !!e.isOnlineMeeting,
    organizer: e.organizer?.emailAddress?.name || e.organizer?.emailAddress?.address || "",
    url: e.webLink ?? "",
    raw: JSON.stringify(e),
  };
}

/** An appointment as Outlook's record — its own (raw) where it has one, else made from the model. */
export function toGraph(e: CalendarEventView & { raw?: string | null }): GraphEvent {
  if (e.raw) {
    try {
      return JSON.parse(e.raw) as GraphEvent;
    } catch {
      // made below
    }
  }
  const dt = (s: string) => (s.length === 10 ? `${s}T00:00:00` : `${s.slice(0, 16)}:00`);
  return {
    id: e.key,
    iCalUId: e.key,
    subject: e.title,
    start: { dateTime: dt(e.start) },
    end: { dateTime: dt(e.end) },
    isAllDay: e.allDay,
    isCancelled: e.cancelled,
    showAs: e.showAs,
    responseStatus: e.response ? { response: e.response } : undefined,
    sensitivity: e.private ? "private" : "normal",
    isOnlineMeeting: e.online,
    organizer: e.organizer ? { emailAddress: { name: e.organizer } } : undefined,
    location: e.location ? { displayName: e.location } : undefined,
    webLink: e.url || undefined,
  };
}

/** Outlook's calendar read in again — when its inbox changed since (and Outlook Kalender is installed). */
export function syncOutlook(): void {
  if (!isInstalled("outlook-calendar")) return;
  const at = inboxWrittenAt();
  if (!at || getPref<number>("calendar:outlook-read", 0) === at) return;
  const cal = ensureCalendar("outlook", { source: "outlook", name: "Outlook", color: "#0F6CBD", book: true });
  replaceEvents(cal.id, readInbox().map(fromGraph));
  setPref("calendar:outlook-read", at);
}

/** The meetings to book, Outlook's way: those of the calendars set for booking (Outlook's by default). */
export function bookableGraphEvents(): GraphEvent[] {
  const cals = new Map(listCalendars().map((c) => [c.id, c]));
  return getDb()
    .select()
    .from(calendarEvents)
    .orderBy(asc(calendarEvents.start))
    .all()
    .filter((e) => cals.get(e.calendarId)?.book)
    .map((e) => toGraph({ ...eventView(e), raw: e.raw }));
}

/** The busy times between two moments: timed appointments of busy calendars, not cancelled, not "free". */
export function busyBetween(from: Date, to: Date): { start: Date; end: Date; title: string }[] {
  const two = (n: number) => String(n).padStart(2, "0");
  const stamp = (d: Date) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}`;
  return eventsBetween(stamp(from), stamp(to), { busy: true })
    .filter((e) => !e.allDay && !e.cancelled && e.showAs !== "free" && e.response !== "declined")
    .map((e) => ({ start: new Date(`${e.start}:00`), end: new Date(`${e.end}:00`), title: e.title }));
}
