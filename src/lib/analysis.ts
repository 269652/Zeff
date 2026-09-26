import { addDays, endOfISOWeek, getISOWeek, getISOWeekYear, startOfISOWeek, subWeeks } from "date-fns";
import { getEarliestEntryDate, listEntries, type EntryWithJob } from "./entries";
import { round2 } from "./format";
import type { EntryType, JiraStatusCategory } from "@/db/schema";
import { earliestJiraDate, hasJiraData, jiraStats, ticketLifecycles, ticketsClosedBetween } from "./jira/store";
import type { TagLite } from "./tags-shared";
import { isoDate } from "./week";

export type TypeHours = Record<EntryType, number>;

export type TagStat = { tag: TagLite; hours: number; entryCount: number };
export type JobStat = { jobNumber: string; jobName: string; hours: number };
export type TicketStat = {
  ticket: string;
  jobNumber: string;
  hours: number;
  entryCount: number;
  days: number;
};
export type WeekStat = {
  weekKey: string;
  startIso: string;
  label: string;
  total: number;
  byType: TypeHours;
  ticketsWorked: number;
  newTickets: number;
  /** Jira tickets resolved (by resolution date) in this week. */
  closed: number;
  /** Jira tickets open at any point during this week (parallel work in flight). */
  wip: number;
  /** Average resolution time (days, open→resolved) of tickets resolved this week, or null. */
  avgResolutionDays: number | null;
};

export type Analysis = {
  range: { fromIso: string; toIso: string; weeks: number; allTime: boolean };
  hasData: boolean;
  totalHours: number;
  entryCount: number;
  activeDays: number;
  byType: TypeHours;
  meetingPercent: number;
  /** Meeting hours divided by the number of days with any booking. */
  avgMeetingHoursPerActiveDay: number;
  distinctTickets: number;
  avgHoursPerActiveWeek: number;
  byTag: TagStat[];
  untaggedHours: number;
  byJob: JobStat[];
  weeks: WeekStat[];
  topTickets: TicketStat[];
  /** Jira completion snapshot (present when tickets have been synced). */
  jira: { total: number; byCategory: Record<JiraStatusCategory, number> } | null;
  /** Jira tickets resolved within the range (by resolution date). */
  ticketsClosed: number;
  /** Average resolution time in days (open→resolved) over tickets resolved in range, or null. */
  avgResolutionDays: number | null;
  /** Average time-to-respond in days (open→first status change) over responses in range, or null. */
  avgReactionDays: number | null;
  /** Number of tickets whose first response fell in range (the reaction-time sample). */
  reactionSample: number;
  /** Tickets resolved in range divided by the number of weeks in range. */
  avgClosedPerWeek: number;
  /** Average number of tickets open in parallel across the weeks in range. */
  avgParallelPerWeek: number;
  /** Whether Jira tickets carry opened dates (resolution / parallelism available). */
  hasTicketDates: boolean;
  /** Whether any ticket has a first-response timestamp (reaction time available). */
  hasReactionData: boolean;
  /**
   * "mine": the Jira metrics cover only the tickets booked in range (`worked` keys, of
   * which `inJira` are synced); "all": every synced ticket in the board scope.
   */
  ticketScope: "all" | "mine";
  myTickets: { worked: number; inJira: number } | null;
};

function emptyTypeHours(): TypeHours {
  return { ticket: 0, meeting: 0, other: 0, absence: 0, internal: 0 };
}

function weekKeyOf(d: Date): string {
  return `${getISOWeekYear(d)}-W${String(getISOWeek(d)).padStart(2, "0")}`;
}

/** The YYYY-MM-DD day part of a Jira timestamp (localized strings start with the ISO date). */
function dayPart(s?: string | null): string | null {
  const d = (s ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

/** Whole days between two YYYY-MM-DD days (b − a), or null if either is missing. */
function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const ms = new Date(b + "T00:00:00").getTime() - new Date(a + "T00:00:00").getTime();
  return Math.max(0, Math.round(ms / 86_400_000));
}

/**
 * Resolve the analysis window: the last `weeks` ISO weeks (including the current
 * one), or all recorded time when `weeks` <= 0.
 */
export function resolveRange(
  weeks: number,
  earliest?: string,
  earliestJira?: string,
): { fromIso: string; toIso: string; weeks: number; allTime: boolean } {
  const today = new Date();
  const toIso = isoDate(endOfISOWeek(today));
  if (weeks > 0) {
    return { fromIso: isoDate(startOfISOWeek(subWeeks(today, weeks - 1))), toIso, weeks, allTime: false };
  }
  // All-time spans the earliest of any signal — time entries OR Jira history —
  // so Jira metrics (closures, cycle time, WIP) aren't cut off by a short booking history.
  const floors = [earliest, earliestJira].filter((d): d is string => !!d);
  const fromIso = floors.length ? floors.sort()[0] : isoDate(startOfISOWeek(subWeeks(today, 11)));
  return { fromIso, toIso, weeks: 0, allTime: true };
}

export function getAnalysis(opts: {
  weeks: number;
  earliest?: string;
  /** "mine" limits the Jira metrics to tickets with time booked in the range. */
  ticketScope?: "all" | "mine";
}): Analysis {
  const jiraPresent = hasJiraData();
  const ticketScope = opts.ticketScope === "mine" ? "mine" : "all";
  // All-time reaches back into Jira history for everyone's metrics; "mine" means your booking history.
  const jiraFloor = jiraPresent && ticketScope === "all" ? earliestJiraDate() ?? undefined : undefined;
  const range = resolveRange(opts.weeks, opts.earliest, jiraFloor);
  const entries = listEntries({ from: range.fromIso, to: range.toIso });
  // "Mine" = every ticket key booked in range, whatever the entry type (a mob session on a ticket counts).
  const myKeys =
    ticketScope === "mine"
      ? new Set(entries.flatMap((e) => (e.ticket?.trim() ? [e.ticket.trim().toLowerCase()] : [])))
      : undefined;

  const byType = emptyTypeHours();
  const tagMap = new Map<number, TagStat>();
  const jobMap = new Map<string, JobStat>();
  const ticketMap = new Map<string, TicketStat & { dates: Set<string> }>();
  const weekMap = new Map<string, WeekStat>();
  const activeDaySet = new Set<string>();
  const ticketFirstWeek = new Map<string, string>();
  let untaggedHours = 0;

  // Pre-create week buckets so gaps show as zero.
  const firstWeekStart = startOfISOWeek(new Date(range.fromIso + "T00:00:00"));
  const lastWeekStart = startOfISOWeek(new Date(range.toIso + "T00:00:00"));
  for (let d = firstWeekStart; d <= lastWeekStart; d = addDays(d, 7)) {
    const key = weekKeyOf(d);
    weekMap.set(key, {
      weekKey: key,
      startIso: isoDate(d),
      label: `${getISOWeek(d)}`,
      total: 0,
      byType: emptyTypeHours(),
      ticketsWorked: 0,
      newTickets: 0,
      closed: 0,
      wip: 0,
      avgResolutionDays: null,
    });
  }
  const weekTickets = new Map<string, Set<string>>();

  for (const e of entries) {
    byType[e.type] = round2(byType[e.type] + e.hours);
    activeDaySet.add(e.date);

    // tags
    if (e.tags.length === 0) untaggedHours = round2(untaggedHours + e.hours);
    for (const t of e.tags) {
      const s = tagMap.get(t.id) ?? { tag: t, hours: 0, entryCount: 0 };
      s.hours = round2(s.hours + e.hours);
      s.entryCount += 1;
      tagMap.set(t.id, s);
    }

    // job
    const js = jobMap.get(e.job.number) ?? { jobNumber: e.job.number, jobName: e.job.name, hours: 0 };
    js.hours = round2(js.hours + e.hours);
    jobMap.set(e.job.number, js);

    // ticket
    if (e.type === "ticket" && e.ticket) {
      const key = e.ticket;
      const ts = ticketMap.get(key) ?? {
        ticket: key,
        jobNumber: e.job.number,
        hours: 0,
        entryCount: 0,
        days: 0,
        dates: new Set<string>(),
      };
      ts.hours = round2(ts.hours + e.hours);
      ts.entryCount += 1;
      ts.dates.add(e.date);
      ticketMap.set(key, ts);
    }

    // week
    const wkey = weekKeyOf(new Date(e.date + "T00:00:00"));
    const wk = weekMap.get(wkey);
    if (wk) {
      wk.total = round2(wk.total + e.hours);
      wk.byType[e.type] = round2(wk.byType[e.type] + e.hours);
      if (e.type === "ticket" && e.ticket) {
        const set = weekTickets.get(wkey) ?? new Set<string>();
        set.add(e.ticket.toLowerCase());
        weekTickets.set(wkey, set);
        if (!ticketFirstWeek.has(e.ticket.toLowerCase())) ticketFirstWeek.set(e.ticket.toLowerCase(), wkey);
      }
    }
  }

  // finalize weeks
  for (const [wkey, set] of weekTickets) {
    const wk = weekMap.get(wkey);
    if (wk) wk.ticketsWorked = set.size;
  }
  for (const [ticketKey, wkey] of ticketFirstWeek) {
    void ticketKey;
    const wk = weekMap.get(wkey);
    if (wk) wk.newTickets += 1;
  }

  // Jira completion + resolution time: bucket resolved tickets by resolution week,
  // and measure open→resolved resolution time per week and overall.
  const jira = jiraPresent ? jiraStats(myKeys) : null;
  let ticketsClosed = 0;
  let resolutionSum = 0;
  let resolutionCount = 0;
  let reactionSum = 0;
  let reactionCount = 0;
  let hasTicketDates = false;
  let hasReactionData = false;
  const weekResolution = new Map<string, { sum: number; n: number }>();
  if (jira) {
    for (const t of ticketsClosedBetween(range.fromIso, range.toIso, myKeys)) {
      const rd = dayPart(t.resolvedAt);
      if (!rd) continue;
      ticketsClosed++;
      const wkey = weekKeyOf(new Date(rd + "T00:00:00"));
      const wk = weekMap.get(wkey);
      if (wk) wk.closed += 1;
      const res = daysBetween(dayPart(t.openedAt), rd);
      if (res !== null) {
        resolutionSum += res;
        resolutionCount++;
        const wr = weekResolution.get(wkey) ?? { sum: 0, n: 0 };
        wr.sum += res;
        wr.n += 1;
        weekResolution.set(wkey, wr);
      }
    }

    const lifecycles = ticketLifecycles(myKeys);
    // Whether the synced data carries these dates at all — judged on every ticket, so a
    // narrow "mine" selection doesn't prompt a pointless re-sync.
    const available = myKeys ? ticketLifecycles() : lifecycles;
    hasTicketDates = available.length > 0;
    hasReactionData = available.some((lc) => lc.respondedAt && lc.openedAt);

    // Reaction time (time to respond): open→first status change, over responses in range.
    for (const lc of lifecycles) {
      const opened = dayPart(lc.openedAt);
      const responded = dayPart(lc.respondedAt);
      if (!opened || !responded) continue;
      if (responded < range.fromIso || responded > range.toIso) continue;
      const react = daysBetween(opened, responded);
      if (react === null) continue;
      reactionSum += react;
      reactionCount++;
    }

    // Parallelism: count tickets open at any point during each week (WIP).
    for (const wk of weekMap.values()) {
      const weekEnd = isoDate(addDays(new Date(wk.startIso + "T00:00:00"), 6));
      let wip = 0;
      for (const lc of lifecycles) {
        const opened = dayPart(lc.openedAt);
        if (!opened || opened > weekEnd) continue; // not opened yet by this week's end
        // A ticket's effective close: its resolution date, or (for done tickets that
        // lack one) its last-updated date, so "done" work doesn't count as open forever.
        const closed = dayPart(lc.resolvedAt) ?? (lc.statusCategory === "done" ? dayPart(lc.updatedAt) : null);
        if (closed && closed < wk.startIso) continue; // already closed before this week
        wip++;
      }
      wk.wip = wip;
      const wr = weekResolution.get(wk.weekKey);
      wk.avgResolutionDays = wr ? round2(wr.sum / wr.n) : null;
    }
  }

  const totalHours = round2(byType.ticket + byType.meeting + byType.other + byType.absence + byType.internal);
  const weeks = [...weekMap.values()].sort((a, b) => a.startIso.localeCompare(b.startIso));
  const activeWeeks = weeks.filter((w) => w.total > 0).length || 1;
  const weekCount = weeks.length || 1;
  const avgResolutionDays = resolutionCount > 0 ? round2(resolutionSum / resolutionCount) : null;
  const avgReactionDays = reactionCount > 0 ? round2(reactionSum / reactionCount) : null;
  const avgClosedPerWeek = round2(ticketsClosed / weekCount);
  const avgParallelPerWeek = round2(weeks.reduce((sum, w) => sum + w.wip, 0) / weekCount);

  const topTickets: TicketStat[] = [...ticketMap.values()]
    .map((t) => ({ ticket: t.ticket, jobNumber: t.jobNumber, hours: t.hours, entryCount: t.entryCount, days: t.dates.size }))
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 10);

  return {
    range,
    hasData: entries.length > 0,
    totalHours,
    entryCount: entries.length,
    activeDays: activeDaySet.size,
    byType,
    meetingPercent: totalHours > 0 ? Math.round((byType.meeting / totalHours) * 100) : 0,
    avgMeetingHoursPerActiveDay: round2(byType.meeting / (activeDaySet.size || 1)),
    distinctTickets: ticketMap.size,
    avgHoursPerActiveWeek: round2(totalHours / activeWeeks),
    byTag: [...tagMap.values()].sort((a, b) => b.hours - a.hours),
    untaggedHours,
    byJob: [...jobMap.values()].sort((a, b) => b.hours - a.hours),
    weeks,
    topTickets,
    jira: jira ? { total: jira.total, byCategory: jira.byCategory } : null,
    ticketsClosed,
    avgResolutionDays,
    avgReactionDays,
    reactionSample: reactionCount,
    avgClosedPerWeek,
    avgParallelPerWeek,
    hasTicketDates,
    hasReactionData,
    ticketScope,
    myTickets: myKeys ? { worked: myKeys.size, inJira: jira?.total ?? 0 } : null,
  };
}

export { getEarliestEntryDate };
export type { EntryWithJob };
