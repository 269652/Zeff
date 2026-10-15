/**
 * Outlook's calendar through Microsoft Graph (the "api" driver): the same weeks, with the same
 * Graph-shaped events, that the Outlook driver's outlook_events reads from the week view — they go
 * into the meeting inbox (replaceInboxWeeks) like those. Read-only: Calendars.Read. Server only.
 */
import { apiGet } from "@/lib/connectors/http";
import { localTimeZone } from "@/lib/calendar/config";

type Page = { value?: Record<string, unknown>[]; "@odata.nextLink"?: string };

const SELECT = [
  "id", "iCalUId", "subject", "start", "end", "isAllDay", "isCancelled", "showAs",
  "responseStatus", "sensitivity", "isOnlineMeeting", "onlineMeetingProvider",
  "organizer", "location", "webLink",
].join(",");

/** The occurrences (recurring series expanded by Graph) overlapping a week, Monday 00:00 local to the next Monday. */
async function readWeek(weekStartIso: string, timeZone: string): Promise<Record<string, unknown>[]> {
  const [y, m, d] = weekStartIso.split("-").map(Number);
  const from = new Date(y, m - 1, d);
  const to = new Date(y, m - 1, d + 7);
  const q = new URLSearchParams({ startDateTime: from.toISOString(), endDateTime: to.toISOString(), $select: SELECT, $orderby: "start/dateTime", $top: "250" });
  const events: Record<string, unknown>[] = [];
  let next: string | undefined = `/me/calendarView?${q}`;
  for (let page = 0; next && page < 20; page++) {
    const r: Page = await apiGet<Page>("microsoft", next, { prefer: `outlook.timezone="${timeZone}"` });
    events.push(...(r.value ?? []));
    next = r["@odata.nextLink"];
  }
  return events;
}

/** Each of these weeks (Monday ISO dates) with its events, times in the server's time zone. */
export async function readWeeks(weekStartIsos: string[]): Promise<{ weekStartIso: string; events: unknown[] }[]> {
  const tz = localTimeZone();
  const weeks: { weekStartIso: string; events: unknown[] }[] = [];
  for (const weekStartIso of weekStartIsos) weeks.push({ weekStartIso, events: await readWeek(weekStartIso, tz) });
  return weeks;
}
