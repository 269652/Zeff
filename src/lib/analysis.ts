import { addDays, endOfISOWeek, getISOWeek, getISOWeekYear, startOfISOWeek, subWeeks } from "date-fns";
import { getEarliestEntryDate, listEntries, type EntryWithJob } from "./entries";
import { round2 } from "./format";
import type { EntryType } from "@/db/schema";
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
  filter: { reportedBy?: string };
};

function emptyTypeHours(): TypeHours {
  return { ticket: 0, meeting: 0, other: 0 };
}

function weekKeyOf(d: Date): string {
  return `${getISOWeekYear(d)}-W${String(getISOWeek(d)).padStart(2, "0")}`;
}

/**
 * Resolve the analysis window: the last `weeks` ISO weeks (including the current
 * one), or all recorded time when `weeks` <= 0.
 */
export function resolveRange(weeks: number, earliest?: string): { fromIso: string; toIso: string; weeks: number; allTime: boolean } {
  const today = new Date();
  const toIso = isoDate(endOfISOWeek(today));
  if (weeks > 0) {
    return { fromIso: isoDate(startOfISOWeek(subWeeks(today, weeks - 1))), toIso, weeks, allTime: false };
  }
  return { fromIso: earliest ?? isoDate(startOfISOWeek(subWeeks(today, 11))), toIso, weeks: 0, allTime: true };
}

export function getAnalysis(opts: { weeks: number; reportedBy?: string; earliest?: string }): Analysis {
  const range = resolveRange(opts.weeks, opts.earliest);
  const entries = listEntries({ from: range.fromIso, to: range.toIso, reportedBy: opts.reportedBy });

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

  const totalHours = round2(byType.ticket + byType.meeting + byType.other);
  const weeks = [...weekMap.values()].sort((a, b) => a.startIso.localeCompare(b.startIso));
  const activeWeeks = weeks.filter((w) => w.total > 0).length || 1;

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
    filter: { reportedBy: opts.reportedBy },
  };
}

export { getEarliestEntryDate };
export type { EntryWithJob };
