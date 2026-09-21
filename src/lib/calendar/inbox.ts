import fs from "node:fs";
import path from "node:path";
import type { GraphEvent } from "./meetings";

/**
 * The "inbox": events pushed in from the browser bookmarklet (or a paste), stored
 * as a JSON file the Next server reads. This is how Zeff loads calendar events
 * without OAuth — the browser (which holds the Outlook session) extracts them and
 * hands them to the server, which then plans and books them like any other source.
 */
const INBOX_PATH =
  process.env.ZEFF_CALENDAR_INBOX ?? path.join(process.cwd(), "data", "calendar-inbox.json");

const MAX_EVENTS = 2000;

/** Keep only the fields the planner uses, and drop anything malformed. */
function sanitize(raw: unknown): GraphEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  const start = e.start as { dateTime?: unknown; timeZone?: unknown } | undefined;
  const end = e.end as { dateTime?: unknown; timeZone?: unknown } | undefined;
  const startDt = start?.dateTime;
  const endDt = end?.dateTime;
  if (typeof startDt !== "string" || typeof endDt !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(startDt)) return null;

  const id = typeof e.id === "string" && e.id ? e.id : undefined;
  const iCalUId = typeof e.iCalUId === "string" && e.iCalUId ? e.iCalUId : id;
  if (!id && !iCalUId) return null;

  const org = e.organizer as { emailAddress?: { name?: unknown; address?: unknown } } | undefined;
  const loc = e.location as { displayName?: unknown } | undefined;
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);

  return {
    id: id ?? (iCalUId as string),
    iCalUId,
    subject: str(e.subject) ?? "",
    start: { dateTime: startDt, timeZone: str(start?.timeZone) },
    end: { dateTime: endDt, timeZone: str(end?.timeZone) },
    isAllDay: Boolean(e.isAllDay),
    isCancelled: Boolean(e.isCancelled),
    showAs: str(e.showAs),
    responseStatus:
      e.responseStatus && typeof e.responseStatus === "object"
        ? { response: str((e.responseStatus as { response?: unknown }).response) }
        : undefined,
    sensitivity: str(e.sensitivity),
    isOnlineMeeting: e.isOnlineMeeting === undefined ? undefined : Boolean(e.isOnlineMeeting),
    onlineMeetingProvider: str(e.onlineMeetingProvider),
    organizer: org?.emailAddress
      ? { emailAddress: { name: str(org.emailAddress.name), address: str(org.emailAddress.address) } }
      : undefined,
    location: loc ? { displayName: str(loc.displayName) } : undefined,
    webLink: str(e.webLink),
  };
}

function keyOf(e: GraphEvent): string {
  return `${e.iCalUId || e.id}@${e.start.dateTime.slice(0, 16)}`;
}

export function readInbox(): GraphEvent[] {
  try {
    const raw = fs.readFileSync(INBOX_PATH, "utf8");
    const json = JSON.parse(raw) as GraphEvent[] | { value?: GraphEvent[] };
    const arr = Array.isArray(json) ? json : (json.value ?? []);
    return arr.map(sanitize).filter((e): e is GraphEvent => e !== null);
  } catch {
    return [];
  }
}

export function inboxCount(): number {
  return readInbox().length;
}

/** Merge incoming events into the inbox (upsert by occurrence key). Returns counts. */
export function mergeIntoInbox(rawEvents: unknown[]): { accepted: number; total: number } {
  const incoming = rawEvents.map(sanitize).filter((e): e is GraphEvent => e !== null);
  const byKey = new Map<string, GraphEvent>();
  for (const e of readInbox()) byKey.set(keyOf(e), e);
  for (const e of incoming) byKey.set(keyOf(e), e);

  let merged = [...byKey.values()].sort((a, b) => a.start.dateTime.localeCompare(b.start.dateTime));
  if (merged.length > MAX_EVENTS) merged = merged.slice(-MAX_EVENTS);

  fs.mkdirSync(path.dirname(INBOX_PATH), { recursive: true });
  fs.writeFileSync(INBOX_PATH, JSON.stringify({ value: merged }, null, 2));
  return { accepted: incoming.length, total: merged.length };
}

export function clearInbox(): void {
  try {
    fs.rmSync(INBOX_PATH, { force: true });
  } catch {
    // ignore
  }
}
