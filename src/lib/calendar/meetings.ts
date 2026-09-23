import { round2 } from "@/lib/format";

/** The subset of a Microsoft Graph `event` resource that the import uses. */
export type GraphEvent = {
  id: string;
  iCalUId?: string;
  subject?: string | null;
  start: { dateTime: string; timeZone?: string };
  end: { dateTime: string; timeZone?: string };
  isAllDay?: boolean;
  isCancelled?: boolean;
  /** free | tentative | busy | oof | workingElsewhere | unknown */
  showAs?: string;
  responseStatus?: { response?: string };
  /** normal | personal | private | confidential */
  sensitivity?: string;
  isOnlineMeeting?: boolean;
  onlineMeetingProvider?: string;
  organizer?: { emailAddress?: { name?: string; address?: string } };
  location?: { displayName?: string };
  webLink?: string;
};

export type ExclusionReason = "all-day" | "cancelled" | "declined" | "not-finished" | "outside-range" | "too-long";

/** Why a meeting is shown but not ticked by default. */
export type MeetingFlag = "imported" | "tentative" | "free" | "private";

export type Meeting = {
  /** Stable id used to prevent double imports: "msgraph:<uid>@<local start>". */
  externalId: string;
  /** Local date, YYYY-MM-DD. */
  date: string;
  startTime: string;
  endTime: string;
  minutes: number;
  /** Duration rounded to quarter hours (minimum 0.25). */
  hours: number;
  subject: string;
  ticket?: string;
  organizer?: string;
  isTeams: boolean;
  flags: MeetingFlag[];
  /** Ticked in the import preview by default. */
  selected: boolean;
};

export type ImportPlan = {
  meetings: Meeting[];
  excluded: { meeting: Meeting; reason: ExclusionReason }[];
};

const TICKET_RE = /\b([A-Z][A-Z0-9]{1,9}-\d{1,6})\b/;

export function extractTicket(subject: string): string | undefined {
  return TICKET_RE.exec(subject)?.[1];
}

/** A rule that auto-assigns a Zeff job to an imported meeting whose title matches. */
export type MeetingJobRule = {
  /** Case-insensitive substring the meeting title must contain (e.g. "Mob Programming"). */
  match: string;
  /** Job number to book the meeting on (e.g. "AB123-000001-00"). */
  jobNumber: string;
};

/** The job number of the first rule whose `match` is a substring of the title, else undefined. */
export function jobForMeeting(subject: string, rules: MeetingJobRule[]): string | undefined {
  const s = (subject ?? "").toLowerCase();
  for (const r of rules) {
    const needle = (r.match ?? "").trim().toLowerCase();
    if (needle && r.jobNumber && s.includes(needle)) return r.jobNumber;
  }
  return undefined;
}

/** Round minutes to the nearest quarter hour, never below 0.25 h. */
export function roundHours(minutes: number): number {
  return Math.max(0.25, round2(Math.round(minutes / 15) * 0.25));
}

/**
 * Graph returns "2026-09-21T09:00:00.0000000" in the requested time zone; build a
 * local Date from the components so DST is handled by the JS runtime.
 */
export function parseLocalDateTime(s: string): Date {
  const [d, t = "00:00:00"] = s.split("T");
  const [y, m, day] = d.split("-").map(Number);
  const [h, mi, sec = "0"] = t.split(":");
  return new Date(y, m - 1, day, Number(h), Number(mi), Math.floor(Number(sec)));
}

function timeOf(s: string): string {
  return s.slice(11, 16);
}

/** Stable per-occurrence id: the iCalendar UID plus the local start time. */
export function externalIdOf(e: GraphEvent): string {
  return `msgraph:${e.iCalUId || e.id}@${e.start.dateTime.slice(0, 16)}`;
}

export function normalizeEvent(e: GraphEvent, imported: Set<string>): Meeting {
  const start = parseLocalDateTime(e.start.dateTime);
  const end = parseLocalDateTime(e.end.dateTime);
  const minutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
  const subject = (e.subject ?? "").trim() || "(no subject)";
  const externalId = externalIdOf(e);

  const flags: MeetingFlag[] = [];
  if (imported.has(externalId)) flags.push("imported");
  if (e.showAs === "tentative") flags.push("tentative");
  if (e.showAs === "free") flags.push("free");
  if (e.sensitivity === "private" || e.sensitivity === "confidential") flags.push("private");

  return {
    externalId,
    date: e.start.dateTime.slice(0, 10),
    startTime: timeOf(e.start.dateTime),
    endTime: timeOf(e.end.dateTime),
    minutes,
    hours: roundHours(minutes),
    subject,
    ticket: extractTicket(subject),
    organizer: e.organizer?.emailAddress?.name || e.organizer?.emailAddress?.address || undefined,
    isTeams:
      e.isOnlineMeeting === true ||
      e.onlineMeetingProvider === "teamsForBusiness" ||
      /teams/i.test(e.location?.displayName ?? ""),
    flags,
    selected: flags.length === 0,
  };
}

function exclusionReason(e: GraphEvent, m: Meeting, from: string, to: string, now: Date): ExclusionReason | null {
  if (e.isAllDay) return "all-day";
  if (e.isCancelled) return "cancelled";
  if (e.responseStatus?.response === "declined") return "declined";
  if (m.date < from || m.date > to) return "outside-range";
  if (m.minutes > 24 * 60) return "too-long";
  if (parseLocalDateTime(e.end.dateTime).getTime() > now.getTime()) return "not-finished";
  return null;
}

/**
 * Turn raw calendar events into an import preview for the inclusive local date
 * range [from, to]: only meetings that have already ended are importable.
 */
export function planImport(
  events: GraphEvent[],
  opts: { from: string; to: string; now: Date; imported: Set<string> },
): ImportPlan {
  const meetings: Meeting[] = [];
  const excluded: ImportPlan["excluded"] = [];
  const seen = new Set<string>();

  for (const e of events) {
    if (!e?.start?.dateTime || !e?.end?.dateTime) continue;
    const m = normalizeEvent(e, opts.imported);
    if (seen.has(m.externalId)) continue;
    seen.add(m.externalId);
    const reason = exclusionReason(e, m, opts.from, opts.to, opts.now);
    if (reason) excluded.push({ meeting: m, reason });
    else meetings.push(m);
  }

  meetings.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  return { meetings, excluded };
}
