/**
 * Google Calendar through Google's REST API with an OAuth sign-in (read-only) — the other driver
 * next to the automation Chrome (src/plugins/google-calendar/driver.mjs): `readCalendar` gives what
 * its `gcal_events` gives. Server only.
 */
import type { EventInput } from "@/lib/calendar/ir";
import { apiGet, apiRequest } from "@/lib/connectors/http";
import { t } from "@/lib/i18n/server";
import { isoDay } from "@/lib/text";

export type GcalRead = {
  calendars: { id: string; name: string; color: string; shown: boolean }[];
  events: (EventInput & { calendarId: string })[];
  unparsed: number;
  from: string;
};

type GEvent = {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  hangoutLink?: string;
  conferenceData?: unknown;
  transparency?: string;
  visibility?: string;
  eventType?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  organizer?: { displayName?: string; email?: string; self?: boolean };
  attendees?: { displayName?: string; email?: string; self?: boolean; responseStatus?: string }[];
};

const two = (n: number) => String(n).padStart(2, "0");
/** A moment as local time, "YYYY-MM-DDTHH:mm" — as the Chrome driver gives it. */
const local = (iso: string): string => {
  const d = new Date(iso);
  return `${isoDay(d)}T${two(d.getHours())}:${two(d.getMinutes())}`;
};

const RESPONSES: Record<string, string> = { accepted: "accepted", declined: "declined", tentative: "tentativelyAccepted", needsAction: "notResponded" };

/** The key the Chrome driver has for an appointment: Google's own event address id (base64 of "<event> <calendar>"). */
const keyOf = (eventId: string, calendarId: string) => Buffer.from(`${eventId} ${calendarId}`).toString("base64url");

function toEvent(e: GEvent, calendarId: string): (EventInput & { calendarId: string }) | null {
  if (!e.start || !e.end) return null;
  const allDay = !!e.start.date;
  const start = allDay ? e.start.date : e.start.dateTime && local(e.start.dateTime);
  const end = allDay ? e.end.date : e.end.dateTime && local(e.end.dateTime);
  if (!start || !end) return null;
  const me = e.attendees?.find((a) => a.self);
  const people = (e.attendees ?? []).map((a) => a.displayName || a.email || "").filter(Boolean);
  return {
    key: keyOf(e.id, calendarId),
    calendarId,
    title: e.summary?.trim() || t("(No title)"),
    start,
    end,
    allDay,
    location: e.location?.trim() || "",
    ...(e.description ? { description: e.description.slice(0, 2000) } : {}),
    showAs: e.transparency === "transparent" ? "free" : e.status === "tentative" ? "tentative" : "busy",
    response: me?.responseStatus ? (RESPONSES[me.responseStatus] ?? null) : null,
    private: e.visibility === "private" || e.visibility === "confidential",
    online: !!(e.hangoutLink || e.conferenceData),
    ...(e.organizer ? { organizer: e.organizer.displayName || e.organizer.email || "" } : {}),
    ...(people.length ? { attendees: people.slice(0, 50) } : {}),
    url: e.htmlLink ?? "",
  };
}

/** The calendars, and the appointments of the weeks from last Monday — recurring ones as their single occurrences. */
export async function readCalendar(o: { weeks: number }): Promise<GcalRead> {
  const weeks = Math.max(1, Math.min(12, Number(o.weeks) || 5));
  // From the Monday of the week before (what just was), at midnight.
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - 7);
  const end = new Date(start);
  end.setDate(end.getDate() + 7 * weeks);

  const calendars: GcalRead["calendars"] = [];
  let token = "";
  do {
    const r = await apiGet<{ items?: { id: string; summary?: string; summaryOverride?: string; backgroundColor?: string; selected?: boolean; hidden?: boolean }[]; nextPageToken?: string }>(
      "google",
      `/calendar/v3/users/me/calendarList?maxResults=250${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`,
    );
    for (const c of r.items ?? []) calendars.push({ id: c.id, name: c.summaryOverride || c.summary || c.id, color: c.backgroundColor ?? "", shown: c.selected === true && !c.hidden });
    token = r.nextPageToken ?? "";
  } while (token);

  const events: GcalRead["events"] = [];
  let unparsed = 0;
  for (const c of calendars) {
    if (!c.shown) continue;
    let page = "";
    do {
      const q = `singleEvents=true&orderBy=startTime&maxResults=250&timeMin=${encodeURIComponent(start.toISOString())}&timeMax=${encodeURIComponent(end.toISOString())}${page ? `&pageToken=${encodeURIComponent(page)}` : ""}`;
      const r = await apiRequest<{ items?: GEvent[]; nextPageToken?: string }>("google", `/calendar/v3/calendars/${encodeURIComponent(c.id)}/events?${q}`);
      // One calendar that can't be read (shared without access …) doesn't stop the others.
      if (r.status < 200 || r.status >= 300) {
        unparsed++;
        break;
      }
      for (const e of r.body?.items ?? []) {
        if (e.status === "cancelled" || e.eventType === "workingLocation") continue;
        const ev = toEvent(e, c.id);
        if (ev) events.push(ev);
        else unparsed++;
      }
      page = r.body?.nextPageToken ?? "";
    } while (page);
  }
  return { calendars, events, unparsed, from: isoDay(start) };
}
