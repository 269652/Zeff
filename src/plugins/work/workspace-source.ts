import { desc } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { t } from "@/lib/i18n/server";
import type { WorkspaceSource } from "@/plugins/workspace/source-point";

/** The workers' runs as something a database can join, by ticket: how many runs, the last one's state, the cost, the minutes. Read only. */
const F = { ticket: "wrticket", status: "wrstatus", mode: "wrmode", branch: "wrbranch", started: "wrstarted", minutes: "wrminutes", cost: "wrcost", ref: "wrref" };

export function runRecords() {
  return getDb()
    .select()
    .from(schema.workRuns)
    .orderBy(desc(schema.workRuns.id))
    .limit(2000)
    .all()
    .map((r) => ({
      ref: `run:${r.id}`,
      title: `W-${r.id}`,
      fields: {} as Record<string, string>,
      updatedAt: r.finishedAt ?? r.startedAt ?? r.queuedAt,
      typed: [
        { id: F.ticket, name: "Ticket", type: "text" as const, value: r.ticket ?? "" },
        { id: F.status, name: "Status", type: "text" as const, value: r.status },
        { id: F.mode, name: "Mode", type: "text" as const, value: r.mode },
        { id: F.branch, name: "Branch", type: "text" as const, value: r.branch ?? "" },
        { id: F.started, name: "Started", type: "date" as const, value: (r.startedAt ?? r.queuedAt ?? "").slice(0, 10) },
        { id: F.minutes, name: "Minutes", type: "number" as const, value: r.durationMs ? Math.round(r.durationMs / 6000) / 10 : null },
        { id: F.cost, name: "Cost (USD)", type: "number" as const, value: r.costUsd ?? null },
        { id: F.ref, name: "Run", type: "text" as const, value: `W-${r.id}` },
      ],
    }));
}

export const RUNS_SOURCE: WorkspaceSource = {
  id: "runs",
  get label() {
    return t("Worker runs");
  },
  icon: "🤖",
  get hint() {
    return t("The runs of your workers with their ticket, state, branch, minutes and cost — tickets can count them or add up the cost.");
  },
  columns: [
    { id: F.ticket, name: "Ticket", type: "text" },
    { id: F.status, name: "Status", type: "text" },
    { id: F.mode, name: "Mode", type: "text" },
    { id: F.branch, name: "Branch", type: "text" },
    { id: F.started, name: "Started", type: "date" },
    { id: F.minutes, name: "Minutes", type: "number" },
    { id: F.cost, name: "Cost (USD)", type: "number" },
    { id: F.ref, name: "Run", type: "text" },
  ],
  count: () => runRecords().length,
  read: runRecords,
  table: runRecords,
  relationOnly: true,
  noNewRows: true,
};
