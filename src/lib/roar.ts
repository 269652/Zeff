import { round2 } from "./format";
import { NO_JOB_NUMBER } from "./projects-shared";
import { getRewrittenJobLines } from "./report";
import { formatDay, isoDate, type WeekInfo } from "./week";

/**
 * The plan pushed to Roar. Roar's timesheet is a job × weekday grid, and each
 * job×day cell can hold several individual entries (each with its own duration
 * and comment). Each line of the rewritten weekly report becomes ONE Roar entry
 * per job — so the report rules decide what groups together and what the comment
 * says ("Meetings", "{ticket}: {ticket-name}", …). Roar only accepts 0.1-hour
 * increments, so each entry's hours are rounded UP to 0.1.
 */
export type RoarEntry = {
  /** Rounded-up-to-0.1 hours for this entry. */
  hours: number;
  /** Roar "Comment" for the entry: the report line's label. */
  comment: string;
};

export type RoarExportRow = {
  jobNumber: string;
  jobName: string;
  /** ISO date -> the individual entries booked for this job that day. */
  entriesByDay: Record<string, RoarEntry[]>;
  /** ISO date -> summed rounded hours (for the preview only). */
  hoursByDay: Record<string, number>;
  /** Total individual entries across the week (how many Roar entries will be created). */
  entryCount: number;
  total: number;
};

export type RoarExportPlan = {
  weekKey: string;
  weekStartIso: string;
  days: { iso: string; label: string }[];
  rows: RoarExportRow[];
  entryCount: number;
  total: number;
  /** Hours on projects without a job yet — never pushed (they'd need a Roar job). */
  unassignedHours: number;
  filter: { reportedBy?: string };
};

/** Roar only accepts 0.1-hour increments, so hours are rounded UP to 0.1. */
export function roundRoarHours(h: number): number {
  return Math.ceil(h * 10 - 1e-9) / 10;
}

/** Roar's comment field caps at 125 chars. */
const COMMENT_MAX = 125;

export function clipComment(s: string): string {
  return s.length > COMMENT_MAX ? s.slice(0, COMMENT_MAX - 1).trimEnd() + "…" : s;
}

/** Build a one-line Roar comment from a Zeff booking: "TICKET: description". */
export function roarComment(ticket: string | null | undefined, description: string): string {
  const t = (ticket ?? "").trim();
  const d = (description ?? "").trim();
  return clipComment(t && d ? `${t}: ${d}` : t || d);
}

export function getRoarExportPlan(week: WeekInfo, filter: { reportedBy?: string } = {}): RoarExportPlan {
  const byJob = new Map<string, RoarExportRow>();
  let unassignedHours = 0;
  // One entry per rewritten report line and job, in chronological order.
  for (const l of getRewrittenJobLines(week, filter)) {
    if (l.jobNumber === NO_JOB_NUMBER) {
      unassignedHours = round2(unassignedHours + l.hours);
      continue;
    }
    let row = byJob.get(l.jobNumber);
    if (!row) {
      row = { jobNumber: l.jobNumber, jobName: l.jobName, entriesByDay: {}, hoursByDay: {}, entryCount: 0, total: 0 };
      byJob.set(l.jobNumber, row);
    }
    (row.entriesByDay[l.date] ??= []).push({
      hours: roundRoarHours(l.hours),
      comment: l.label ? clipComment(l.label) : roarComment(l.first.ticket, l.first.description),
    });
  }
  // Derive per-day sums + totals from the rounded entries.
  for (const row of byJob.values()) {
    let total = 0;
    let count = 0;
    for (const [d, items] of Object.entries(row.entriesByDay)) {
      let day = 0;
      for (const it of items) { day = round2(day + it.hours); count += 1; }
      row.hoursByDay[d] = day;
      total = round2(total + day);
    }
    row.total = total;
    row.entryCount = count;
  }
  const rows = [...byJob.values()].sort((a, b) => a.jobNumber.localeCompare(b.jobNumber, undefined, { numeric: true }));
  return {
    weekKey: week.key,
    weekStartIso: week.startIso,
    days: week.days.map((d) => ({ iso: isoDate(d), label: formatDay(d, "EEE d") })),
    rows,
    entryCount: rows.reduce((a, r) => a + r.entryCount, 0),
    total: round2(rows.reduce((a, r) => a + r.total, 0)),
    unassignedHours,
    filter,
  };
}

/** The compact payload handed to the roar-mcp export tool. */
export type RoarExportPayload = {
  weekStartIso: string;
  rows: {
    jobNumber: string;
    jobName: string;
    /** ISO date -> individual entries to create in that cell. */
    entriesByDay: Record<string, RoarEntry[]>;
    /** Optional forced Roar WorkCode for this job (code or keyword), matched against the job's list. */
    workcode?: string;
  }[];
  /** Jobs Zeff is the source of truth for: their Roar entries that Zeff no longer has are zeroed. */
  managedJobs?: string[];
};

export function toRoarPayload(plan: RoarExportPlan): RoarExportPayload {
  return {
    weekStartIso: plan.weekStartIso,
    rows: plan.rows.map((r) => ({ jobNumber: r.jobNumber, jobName: r.jobName, entriesByDay: r.entriesByDay })),
  };
}
