/**
 * Google Calendar written through its API — an event made, moved or edited, an invitation answered — always on your click (the
 * calendar app, a todo's action; never an agent's tool), only with Google Calendar's write access (the Connections page) and
 * only in a calendar you own or may write to. Nothing is deleted or cancelled (the writes go through write-guard.ts). After each
 * write the days it touched are read again, so Zeff's copy shows it at once. Server only.
 */
import { apiGet } from "@/lib/connectors/http";
import { getConnector } from "@/lib/connectors/store";
import { t } from "@/lib/i18n/server";
import { googleWrite } from "./write-guard";
import { localDay } from "@/lib/dates";

export const CALENDAR_WRITE_SCOPE = "https://www.googleapis.com/auth/calendar.events";

/** Whether the Google sign-in holds the right to write events. */
export const gcalCanWrite = (): boolean => getConnector("google").scope.split(/\s+/).some((s) => s === CALENDAR_WRITE_SCOPE || s === "https://www.googleapis.com/auth/calendar");

export type GcalEventInput = {
  title: string;
  /** Local "YYYY-MM-DDTHH:MM" — all day: "YYYY-MM-DD" (the end the day after the last). */
  start: string;
  end: string;
  allDay?: boolean;
  location?: string;
  description?: string;
  /** Guests by mail address: invited (Google sends them the invitation). */
  attendees?: string[];
};

export type GcalResponse = "accepted" | "declined" | "tentative";
const RESPONSES: GcalResponse[] = ["accepted", "declined", "tentative"];

type GEvent = {
  id: string;
  status?: string;
  htmlLink?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  organizer?: { email?: string; self?: boolean };
  attendees?: { email?: string; self?: boolean; responseStatus?: string; [k: string]: unknown }[];
};

const enc = encodeURIComponent;
const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const noRight = () => new Error(t("Google was only asked for read access to the calendar. Allow writing to Google Calendar on the Connections page and sign in to Google again."));

/** A calendar you may write to: its id (primary resolved) — else an error. */
async function writable(calendarId: string): Promise<string> {
  if (!gcalCanWrite()) throw noRight();
  const c = await apiGet<{ id: string; accessRole?: string }>("google", `/calendar/v3/users/me/calendarList/${enc(calendarId)}`);
  if (c.accessRole !== "owner" && c.accessRole !== "writer") throw new Error(t("Zeff can't write to this Google calendar — it is read-only for you."));
  return c.id;
}

/** Start and end as Google takes them: dates (all day), else local times in this time zone. */
function times(start: string, end: string, allDay: boolean): { start: Record<string, string>; end: Record<string, string> } {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const stamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
  if (allDay) {
    const s = start.slice(0, 10);
    const e = end.slice(0, 10);
    if (!day.test(s) || !day.test(e) || e <= s) throw new Error(t("A start and an end after it, please."));
    return { start: { date: s }, end: { date: e } };
  }
  const s = start.slice(0, 16);
  const e = end.slice(0, 16);
  if (!stamp.test(s) || !stamp.test(e) || e <= s) throw new Error(t("A start and an end after it, please."));
  return { start: { dateTime: `${s}:00`, timeZone: zone() }, end: { dateTime: `${e}:00`, timeZone: zone() } };
}

const mails = (list: string[] | undefined) => [...new Set((list ?? []).map((x) => String(x).trim().toLowerCase()).filter((x) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(x)))];

const failed = (status: number, body: unknown) => new Error(t("Google Calendar refused it ({status}): {why}", { status, why: JSON.stringify((body as { error?: { message?: string } })?.error?.message ?? body ?? "").slice(0, 200) }));

/** The local day of a Google time ("2026-10-27", "2026-10-27T10:00:00+01:00"). */
function dayOf(v: { date?: string; dateTime?: string } | undefined): string | null {
  if (v?.date) return v.date;
  if (!v?.dateTime) return null;
  const d = new Date(v.dateTime);
  return localDay(d);
}
const nextDay = (day: string) => {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return localDay(d);
};

/** The days a write touched, read again from Google into Zeff's copy of that calendar (only that one). Never fails the write. */
export async function refreshGcalDays(calendarId: string, days: (string | null)[]): Promise<void> {
  const known = days.filter((d): d is string => !!d).sort();
  if (!known.length) return;
  try {
    const range = { from: known[0], to: nextDay(known.at(-1)!) };
    const { readCalendar } = await import("./calendar-api");
    const { applyRead } = await import("@/plugins/google-calendar/sync");
    applyRead(await readCalendar({ ...range, only: calendarId }), range);
  } catch (e) {
    console.error("[gcal] reading the days written again failed", e);
  }
}

/** A new event in a calendar of yours ("primary": your main one). Guests are invited (Google mails them). */
export async function insertGcalEvent(calendarId: string, e: GcalEventInput): Promise<{ id: string; calendarId: string; htmlLink: string }> {
  const id = await writable(calendarId);
  const title = String(e.title ?? "").trim();
  if (!title) throw new Error(t("A title, please."));
  const guests = mails(e.attendees);
  const body = {
    summary: title.slice(0, 500),
    ...times(e.start, e.end, !!e.allDay),
    ...(e.location?.trim() ? { location: e.location.trim().slice(0, 500) } : {}),
    ...(e.description?.trim() ? { description: e.description.trim().slice(0, 8000) } : {}),
    ...(guests.length ? { attendees: guests.map((email) => ({ email })) } : {}),
  };
  const r = await googleWrite<GEvent>("POST", `/calendar/v3/calendars/${enc(calendarId)}/events?sendUpdates=${guests.length ? "all" : "none"}`, body);
  if (r.status < 200 || r.status >= 300 || !r.body?.id) throw failed(r.status, r.body);
  await refreshGcalDays(id, [dayOf(body.start), dayOf(body.end)]);
  return { id: r.body.id, calendarId: id, htmlLink: r.body.htmlLink ?? "" };
}

/**
 * An event of yours changed — moved, retimed, renamed, its place or notes — only what is given. Someone else's meeting isn't
 * moved from here (answer the invitation instead); guests are told of a change to your meeting.
 */
export async function patchGcalEvent(calendarId: string, eventId: string, patch: Partial<GcalEventInput>): Promise<{ id: string }> {
  const id = await writable(calendarId);
  const before = await apiGet<GEvent>("google", `/calendar/v3/calendars/${enc(calendarId)}/events/${enc(eventId)}`);
  if (before.organizer && !before.organizer.self) throw new Error(t("This is someone else's meeting — only its organiser can change it. Answer the invitation instead."));
  const body: Record<string, unknown> = {};
  if (patch.title !== undefined) {
    if (!patch.title.trim()) throw new Error(t("A title, please."));
    body.summary = patch.title.trim().slice(0, 500);
  }
  if (patch.start !== undefined || patch.end !== undefined) {
    if (!patch.start || !patch.end) throw new Error(t("A start and an end after it, please."));
    Object.assign(body, times(patch.start, patch.end, !!patch.allDay));
  }
  if (patch.location !== undefined) body.location = patch.location.trim().slice(0, 500);
  if (patch.description !== undefined) body.description = patch.description.trim().slice(0, 8000);
  if (patch.attendees !== undefined) body.attendees = mails(patch.attendees).map((email) => ({ email, ...(before.attendees?.find((a) => a.email?.toLowerCase() === email) ?? {}) }));
  if (!Object.keys(body).length) return { id: eventId };
  const guests = (before.attendees ?? []).some((a) => !a.self) || !!patch.attendees?.length;
  const r = await googleWrite<GEvent>("PATCH", `/calendar/v3/calendars/${enc(calendarId)}/events/${enc(eventId)}?sendUpdates=${guests ? "all" : "none"}`, body);
  if (r.status < 200 || r.status >= 300) throw failed(r.status, r.body);
  await refreshGcalDays(id, [dayOf(before.start), dayOf(before.end), dayOf(body.start as GEvent["start"]), dayOf(body.end as GEvent["end"])]);
  return { id: eventId };
}

/** Your answer to an invitation — yes, no, maybe — for you alone (the others' answers stay); the organiser is told. */
export async function respondGcalEvent(calendarId: string, eventId: string, response: GcalResponse): Promise<void> {
  if (!RESPONSES.includes(response)) throw new Error(t("An answer is accepted, declined or tentative."));
  const id = await writable(calendarId);
  const ev = await apiGet<GEvent>("google", `/calendar/v3/calendars/${enc(calendarId)}/events/${enc(eventId)}`);
  const attendees = ev.attendees ?? [];
  if (!attendees.some((a) => a.self)) throw new Error(t("You aren't invited to this event — there is nothing to answer."));
  const body = { attendees: attendees.map((a) => (a.self ? { ...a, responseStatus: response } : a)) };
  const r = await googleWrite("PATCH", `/calendar/v3/calendars/${enc(calendarId)}/events/${enc(eventId)}?sendUpdates=all`, body);
  if (r.status < 200 || r.status >= 300) throw failed(r.status, r.body);
  await refreshGcalDays(id, [dayOf(ev.start), dayOf(ev.end)]);
}

/** A Google event's ids from Zeff's key for it (base64url of "<event id> <calendar id>", as both drivers make it). */
export function gcalIdsOf(key: string): { eventId: string; calendarId: string } | null {
  try {
    const [eventId, calendarId] = Buffer.from(String(key ?? ""), "base64url").toString("utf8").split(" ");
    return eventId && calendarId && /^[\w-]+$/.test(eventId) ? { eventId, calendarId } : null;
  } catch {
    return null;
  }
}
