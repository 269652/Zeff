import { addDays, eachDayOfInterval, parseISO } from "date-fns";
import { getDayTotals, listBookedEntries, type EntryWithJob, type JobRef, type ProjectRef } from "./entries";
import { round2 } from "./format";
import { isNoJobPlaceholder } from "./jobs";
import type { MonthInfo } from "./month";
import { getDayTargets } from "./schedule";
import type { TagLite } from "./tags-shared";
import { isoDate, weekFromDate } from "./week";

/** One completed week's hours (only its days inside the period count). */
export type PastWeekDue = {
  key: string;
  week: number;
  booked: number;
  target: number;
  /** Hours missing on its days (each day's shortfall against its target). */
  missing: number;
  /** The days short of their target, with how much. */
  shortDays: { date: string; gap: number }[];
};

export type PastWeeksDue = {
  /** The completed weeks of the period, oldest first. */
  weeks: PastWeekDue[];
  missing: number;
  /** The first day counted. */
  fromIso: string;
  /** No verdict while a reporter filter shows only part of the bookings. */
  filtered: boolean;
};

/**
 * Hours still due in the completed weeks of a period — every week before today's, with its
 * days clipped to the period: each day short of its target counts what's missing.
 */
export function getPastWeeksDue(fromIso: string, toIso: string, today: string, filter: { reportedBy?: string } = {}): PastWeeksDue {
  const filtered = !!filter.reportedBy;
  const currentStart = weekFromDate(parseISO(today)).startIso;
  const lastIso = [toIso, isoDate(addDays(parseISO(currentStart), -1))].sort()[0];
  const out: PastWeeksDue = { weeks: [], missing: 0, fromIso, filtered };
  if (fromIso > lastIso) return out;
  const days = eachDayOfInterval({ start: parseISO(fromIso), end: parseISO(lastIso) });
  const totals = getDayTotals(fromIso, lastIso, filter.reportedBy);
  const targets = getDayTargets(days);
  const byWeek = new Map<string, PastWeekDue>();
  days.forEach((d, i) => {
    const w = weekFromDate(d);
    const wk = byWeek.get(w.key) ?? { key: w.key, week: w.week, booked: 0, target: 0, missing: 0, shortDays: [] };
    const booked = totals.get(targets[i].date) ?? 0;
    const gap = round2(targets[i].target - booked);
    wk.booked = round2(wk.booked + booked);
    wk.target = round2(wk.target + targets[i].target);
    if (!filtered && targets[i].target > 0 && gap >= 0.01) {
      wk.missing = round2(wk.missing + gap);
      wk.shortDays.push({ date: targets[i].date, gap });
    }
    byWeek.set(w.key, wk);
  });
  // Weeks with nothing due and nothing booked (e.g. a month's first weekend) have nothing to show.
  out.weeks = [...byWeek.values()].filter((w) => w.target > 0 || w.booked > 0);
  out.missing = round2(out.weeks.reduce((a, w) => a + w.missing, 0));
  return out;
}

export type MonthlyRow = {
  job: JobRef;
  /** Set on a project's row: the project's entries on this job, shown under its title. */
  project: ProjectRef | null;
  /** Hours per week of `month.weeks` (only the month's days). */
  hoursByWeek: number[];
  total: number;
};

export type MonthlyReport = {
  month: MonthInfo;
  /** One row per job, plus one per project — as on the weekly page. */
  rows: MonthlyRow[];
  /** Hours per day, index 0 = the 1st. */
  dayTotals: number[];
  /** Hours per week of `month.weeks` (only the month's days). */
  weekTotals: number[];
  total: number;
  /** All entries of the month, newest first. */
  entries: EntryWithJob[];
  /** Hours per entry type key (only types with hours). */
  byType: Record<string, number>;
  /** Hours per tag, most first. */
  byTag: { tag: TagLite; hours: number }[];
  untaggedHours: number;
  filter: { reportedBy?: string };
};

export function getMonthlyReport(month: MonthInfo, filter: { reportedBy?: string } = {}): MonthlyReport {
  const entries = listBookedEntries({ from: month.startIso, to: month.endIso, reportedBy: filter.reportedBy });
  const dayIndex = new Map(month.days.map((d, i) => [isoDate(d), i]));
  const weekIndex = new Map(
    month.days.map((d) => {
      const iso = isoDate(d);
      return [iso, month.weeks.findIndex((w) => iso >= w.startIso && iso <= w.endIso)];
    }),
  );

  const byRow = new Map<string, MonthlyRow>();
  const dayTotals = Array(month.days.length).fill(0) as number[];
  const weekTotals = Array(month.weeks.length).fill(0) as number[];
  const byType: Record<string, number> = {};
  const tagMap = new Map<number, { tag: TagLite; hours: number }>();
  let untaggedHours = 0;

  for (const e of entries) {
    const di = dayIndex.get(e.date);
    const wi = weekIndex.get(e.date);
    if (di === undefined || wi === undefined || wi < 0) continue;
    const key = `${e.jobId}:${e.projectId ?? ""}`;
    let row = byRow.get(key);
    if (!row) {
      row = { job: e.job, project: e.project, hoursByWeek: Array(month.weeks.length).fill(0) as number[], total: 0 };
      byRow.set(key, row);
    }
    row.hoursByWeek[wi] = round2(row.hoursByWeek[wi] + e.hours);
    row.total = round2(row.total + e.hours);
    dayTotals[di] = round2(dayTotals[di] + e.hours);
    weekTotals[wi] = round2(weekTotals[wi] + e.hours);
    byType[e.type] = round2((byType[e.type] ?? 0) + e.hours);
    if (e.tags.length === 0) untaggedHours = round2(untaggedHours + e.hours);
    for (const t of e.tags) {
      const s = tagMap.get(t.id) ?? { tag: t, hours: 0 };
      s.hours = round2(s.hours + e.hours);
      tagMap.set(t.id, s);
    }
  }

  // As on the weekly page: by job number, a job's own row before its projects, projects without a job last.
  const placeholderLast = (r: MonthlyRow) => (isNoJobPlaceholder(r.job) ? 1 : 0);
  const rows = [...byRow.values()].sort(
    (a, b) =>
      placeholderLast(a) - placeholderLast(b) ||
      a.job.number.localeCompare(b.job.number, undefined, { numeric: true }) ||
      (a.project ? 1 : 0) - (b.project ? 1 : 0) ||
      (a.project?.title ?? "").localeCompare(b.project?.title ?? ""),
  );

  return {
    month,
    rows,
    dayTotals,
    weekTotals,
    total: round2(dayTotals.reduce((a, b) => a + b, 0)),
    entries,
    byType,
    byTag: [...tagMap.values()].sort((a, b) => b.hours - a.hours),
    untaggedHours,
    filter,
  };
}
