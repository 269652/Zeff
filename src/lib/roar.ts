import { listEntries } from "./entries";
import { round2 } from "./format";
import { formatDay, isoDate, type WeekInfo } from "./week";

/**
 * The plan pushed to Roar: Roar's timesheet is a job × weekday grid of hours, so
 * Zeff entries are summed per job number per day. Descriptions/tickets are not
 * transferred (Roar's grid is hours-only).
 */
export type RoarExportRow = {
  jobNumber: string;
  jobName: string;
  /** ISO date (YYYY-MM-DD) -> summed hours for this job that day. */
  hoursByDay: Record<string, number>;
  total: number;
};

export type RoarExportPlan = {
  weekKey: string;
  weekStartIso: string;
  days: { iso: string; label: string }[];
  rows: RoarExportRow[];
  total: number;
  filter: { reportedBy?: string };
};

export function getRoarExportPlan(week: WeekInfo, filter: { reportedBy?: string } = {}): RoarExportPlan {
  const entries = listEntries({ from: week.startIso, to: week.endIso, reportedBy: filter.reportedBy });
  const byJob = new Map<string, RoarExportRow>();
  for (const e of entries) {
    let row = byJob.get(e.job.number);
    if (!row) {
      row = { jobNumber: e.job.number, jobName: e.job.name, hoursByDay: {}, total: 0 };
      byJob.set(e.job.number, row);
    }
    row.hoursByDay[e.date] = round2((row.hoursByDay[e.date] ?? 0) + e.hours);
    row.total = round2(row.total + e.hours);
  }
  const rows = [...byJob.values()].sort((a, b) => a.jobNumber.localeCompare(b.jobNumber));
  return {
    weekKey: week.key,
    weekStartIso: week.startIso,
    days: week.days.map((d) => ({ iso: isoDate(d), label: formatDay(d, "EEE d") })),
    rows,
    total: round2(rows.reduce((a, r) => a + r.total, 0)),
    filter,
  };
}

/** The compact payload handed to the roar-mcp export tool. */
export type RoarExportPayload = {
  weekStartIso: string;
  rows: { jobNumber: string; jobName: string; hoursByDay: Record<string, number> }[];
};

export function toRoarPayload(plan: RoarExportPlan): RoarExportPayload {
  return {
    weekStartIso: plan.weekStartIso,
    rows: plan.rows.map((r) => ({ jobNumber: r.jobNumber, jobName: r.jobName, hoursByDay: r.hoursByDay })),
  };
}
