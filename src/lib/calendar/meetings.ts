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

export type ExclusionReason =
  | "all-day"
  | "cancelled"
  | "declined"
  | "not-finished"
  | "outside-range"
  | "too-long"
  | "no-title";

/** Why a meeting is shown but not ticked by default. */
export type MeetingFlag = "imported" | "excluded" | "tentative" | "free" | "private";

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
  /** A group meeting (a mob day): its entry collects the day's work — what you implement is itemized under it, not booked on top. */
  group?: boolean;
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

/** Whether the first rule matching the title is a group rule (see MeetingJobRule.group). */
export function groupForMeeting(subject: string, rules: MeetingJobRule[]): boolean {
  const s = (subject ?? "").toLowerCase();
  for (const r of rules) {
    const needle = (r.match ?? "").trim().toLowerCase();
    if (needle && r.jobNumber && s.includes(needle)) return !!r.group;
  }
  return false;
}

/** Whether a meeting title matches an exclude rule (case-insensitive "title contains"). */
export function isExcludedMeeting(subject: string, rules: string[]): boolean {
  const s = (subject ?? "").toLowerCase();
  return rules.some((r) => {
    const needle = (r ?? "").trim().toLowerCase();
    return !!needle && s.includes(needle);
  });
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

/** A title reduced to lowercase letters/digits and single spaces: "PROJ | Townhall" → "proj townhall". */
export function normTitle(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * The occurrence a bookmarklet id stands for — local start + title, compared without
 * punctuation or spacing. Those ids ("msgraph:owa:<date>T<HH:MM>:<title, 50 chars>@…")
 * embed the title text, so a meeting shown as "PROJ Townhall" on one run and "PROJ |
 * Townhall" on the next must still count as the same occurrence.
 */
function occurrenceKey(date: string, time: string, title: string): string {
  return `${date}T${time}|${normTitle(title).replace(/ /g, "")}`;
}
function occurrenceKeyOfId(externalId: string): string | null {
  const m = /^msgraph:owa:(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}):(.*)@/.exec(externalId);
  return m ? occurrenceKey(m[1], m[2], m[3].replace(/_/g, " ")) : null;
}

/** A booked time entry, as far as matching calendar meetings to it needs. */
export type BookedEntry = { id: number; date: string; description: string; type: string; externalId: string | null };

/**
 * Which of these (importable) meetings are already booked, by externalId. A meeting is
 * booked when an entry carries its import id — exactly, or for the same occurrence with a
 * reformatted title — or else when a meeting entry that day has the same title (booked by
 * hand, or the meeting was moved): an identical title first, then one containing the other
 * as whole words. Each entry vouches for at most one meeting.
 */
export function findBookedMeetings(meetings: Meeting[], entries: BookedEntry[]): Set<string> {
  const booked = new Set<string>();
  const used = new Set<number>();
  const byId = new Map<string, BookedEntry>();
  const byKey = new Map<string, BookedEntry[]>();
  for (const en of entries) {
    if (!en.externalId) continue;
    byId.set(en.externalId, en);
    const k = occurrenceKeyOfId(en.externalId);
    if (k) byKey.set(k, [...(byKey.get(k) ?? []), en]);
  }
  const claim = (m: Meeting, en: BookedEntry | undefined) => {
    if (!en || used.has(en.id)) return false;
    used.add(en.id);
    booked.add(m.externalId);
    return true;
  };

  const rest: Meeting[] = [];
  for (const m of meetings) {
    const key = occurrenceKey(m.date, m.startTime, m.subject.slice(0, 50));
    if (!claim(m, byId.get(m.externalId)) && !claim(m, byKey.get(key)?.find((en) => !used.has(en.id)))) rest.push(m);
  }
  const wordsIn = (hay: string, needle: string) => needle.length >= 4 && ` ${hay} `.includes(` ${needle} `);
  for (const sameTitle of [true, false]) {
    for (const m of rest) {
      if (booked.has(m.externalId)) continue;
      const t = normTitle(m.subject);
      if (!t) continue;
      claim(
        m,
        entries.find((en) => {
          if (used.has(en.id) || en.type !== "meeting" || en.date !== m.date) return false;
          const d = normTitle(en.description);
          return sameTitle ? d === t : wordsIn(t, d) || wordsIn(d, t);
        }),
      );
    }
  }
  return booked;
}

export function normalizeEvent(e: GraphEvent): Meeting {
  const start = parseLocalDateTime(e.start.dateTime);
  const end = parseLocalDateTime(e.end.dateTime);
  const minutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
  const subject = (e.subject ?? "").trim() || "(no subject)";
  const externalId = externalIdOf(e);

  const flags: MeetingFlag[] = [];
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
  // Outlook's working-location blocks ("13:00 bis 13:30, …, Arbeitsort …") have no title of their own.
  if (/^\d{1,2}:\d{2}\s*(?:bis|to|–|-)\s*\d{1,2}:\d{2}\b/i.test(m.subject) || /\b(Arbeitsort|Working location)\b/i.test(m.subject)) {
    return "no-title";
  }
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
  opts: { from: string; to: string; now: Date; booked: BookedEntry[]; excludeRules?: string[] },
): ImportPlan {
  const meetings: Meeting[] = [];
  const excluded: ImportPlan["excluded"] = [];
  const seen = new Set<string>();

  for (const e of events) {
    if (!e?.start?.dateTime || !e?.end?.dateTime) continue;
    const m = normalizeEvent(e);
    if (seen.has(m.externalId)) continue;
    seen.add(m.externalId);
    const reason = exclusionReason(e, m, opts.from, opts.to, opts.now);
    if (reason) excluded.push({ meeting: m, reason });
    else meetings.push(m);
  }

  meetings.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  // Only importable meetings are matched, so e.g. a cancelled "Daily extended" can't claim the Daily's booking.
  const booked = findBookedMeetings(meetings, opts.booked);
  for (const m of meetings) {
    if (booked.has(m.externalId)) m.flags.unshift("imported");
    if (isExcludedMeeting(m.subject, opts.excludeRules ?? [])) m.flags.push("excluded");
    m.selected = m.flags.length === 0;
  }
  return { meetings, excluded };
}
