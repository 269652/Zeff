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

/** When the inbox was last written (ms; 0: never) — the calendar model reads it in again after that. */
export function inboxWrittenAt(): number {
  try {
    return fs.statSync(INBOX_PATH).mtimeMs;
  } catch {
    return 0;
  }
}

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

/** The inbox file: its events, and when each week was last synced from Outlook (Monday → ISO time). */
type InboxFile = { value: unknown[]; synced: Record<string, string> };

function readFile(): InboxFile {
  try {
    const json = JSON.parse(fs.readFileSync(INBOX_PATH, "utf8")) as unknown[] | { value?: unknown[]; synced?: Record<string, string> };
    return Array.isArray(json) ? { value: json, synced: {} } : { value: json.value ?? [], synced: json.synced ?? {} };
  } catch {
    return { value: [], synced: {} };
  }
}

/** Sort, cap and store events (keeping the latest MAX_EVENTS) with the sync times. */
function writeFile(events: GraphEvent[], synced: Record<string, string>): number {
  let merged = [...events].sort((a, b) => a.start.dateTime.localeCompare(b.start.dateTime));
  if (merged.length > MAX_EVENTS) merged = merged.slice(-MAX_EVENTS);
  fs.mkdirSync(path.dirname(INBOX_PATH), { recursive: true });
  fs.writeFileSync(INBOX_PATH, JSON.stringify({ value: merged, synced }, null, 2));
  return merged.length;
}

export function readInbox(): GraphEvent[] {
  return readFile().value.map(sanitize).filter((e): e is GraphEvent => e !== null);
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
  const total = writeFile([...byKey.values()], readFile().synced);
  return { accepted: incoming.length, total };
}

/**
 * Store a sync of whole weeks (Monday + its events): each week's events replace what the inbox
 * had for it — so meetings moved or deleted in Outlook go away — and its sync time is noted.
 */
export function replaceInboxWeeks(weeks: { weekStartIso: string; events: unknown[] }[]): { events: number; total: number } {
  const sunday = (monday: string) => {
    const [y, m, d] = monday.split("-").map(Number);
    const s = new Date(y, m - 1, d + 6);
    return `${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, "0")}-${String(s.getDate()).padStart(2, "0")}`;
  };
  const ranges = weeks.map((w) => [w.weekStartIso, sunday(w.weekStartIso)]);
  const synced = (e: GraphEvent) => {
    const day = e.start.dateTime.slice(0, 10);
    return ranges.some(([from, to]) => day >= from && day <= to);
  };
  const file = readFile();
  const byKey = new Map<string, GraphEvent>();
  for (const e of file.value.map(sanitize)) if (e && !synced(e)) byKey.set(keyOf(e), e);
  let events = 0;
  for (const w of weeks) {
    for (const e of w.events.map(sanitize)) {
      if (!e) continue;
      byKey.set(keyOf(e), e);
      events++;
    }
  }
  const at = new Date().toISOString();
  const times = { ...file.synced, ...Object.fromEntries(weeks.map((w) => [w.weekStartIso, at])) };
  return { events, total: writeFile([...byKey.values()], times) };
}

/** When the week (its Monday) was last synced from Outlook, if ever. */
export function inboxSyncedAt(weekStartIso: string): string | null {
  return readFile().synced[weekStartIso] ?? null;
}

export function clearInbox(): void {
  try {
    fs.rmSync(INBOX_PATH, { force: true });
  } catch {
    // ignore
  }
}
