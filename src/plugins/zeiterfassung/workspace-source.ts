import { t } from "@/lib/i18n/server";
import { listBookedEntries } from "@/lib/entries";
import type { WorkspaceSource } from "@/plugins/workspace/source-point";

/**
 * The time you booked as a source of the Workspace's pipelines — one record per entry (as it is booked: grouped parallel work counts
 * once), with its date, hours, ticket, job, project, type and who reported it. Read only; what makes it useful is a matching relation
 * from a database of tickets, projects or jobs, with a rollup (sum of Hours) over it.
 */
const F = { date: "timedate", hours: "timehours", ticket: "timeticket", job: "timejob", project: "timeproject", type: "timetype", by: "timeby" };

export function timeRecords() {
  return listBookedEntries().map((e) => ({
    ref: `time:${e.id}`,
    title: e.description,
    fields: {} as Record<string, string>,
    updatedAt: e.updatedAt,
    typed: [
      { id: F.date, name: "Date", type: "date" as const, value: e.date },
      { id: F.hours, name: "Hours", type: "number" as const, value: e.hours },
      { id: F.ticket, name: "Ticket", type: "text" as const, value: e.ticket ?? "" },
      { id: F.job, name: "Job", type: "text" as const, value: `${e.job.number} ${e.job.name}`.trim() },
      { id: F.project, name: "Project", type: "text" as const, value: e.project?.title ?? "" },
      { id: F.type, name: "Type", type: "text" as const, value: e.type },
      { id: F.by, name: "Reported by", type: "text" as const, value: e.reportedBy },
    ],
  }));
}

export const TIME_SOURCE: WorkspaceSource = {
  id: "time",
  get label() {
    return t("Time booked");
  },
  icon: "⏱️",
  get hint() {
    return t("Your booked time, one row per entry — with date, hours, ticket, job and project. Tickets, projects or jobs can add it up (a matching relation and a rollup).");
  },
  columns: [
    { id: F.date, name: "Date", type: "date" },
    { id: F.hours, name: "Hours", type: "number" },
    { id: F.ticket, name: "Ticket", type: "text" },
    { id: F.job, name: "Job", type: "text" },
    { id: F.project, name: "Project", type: "text" },
    { id: F.type, name: "Type", type: "text" },
    { id: F.by, name: "Reported by", type: "text" },
  ],
  count: () => listBookedEntries().length,
  read: timeRecords,
  table: timeRecords,
  relationOnly: true,
  noNewRows: true,
};
