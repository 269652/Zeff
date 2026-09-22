import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { ConflictError, NotFoundError, ValidationError, errorMessage } from "@/lib/errors";
import {
  createEntry,
  deleteEntry,
  getJobHours,
  getJobNumberForTicket,
  getWeeklyReport,
  listEntries,
  updateEntry,
  type EntryWithJob,
  type WeeklyReport,
} from "@/lib/entries";
import { formatHours } from "@/lib/format";
import { getTicketDefaultJob } from "@/lib/jira/store";
import { createJob, listJobs } from "@/lib/jobs";
import { formatDay, formatWeekRange, resolveWeek, todayIso, weekFromDate } from "@/lib/week";

export const SERVER_INFO = { name: "zeff", version: "0.1.0" };

export const INSTRUCTIONS = `Zeff is a time-tracking (Zeiterfassung) server. Time is booked in hours against job numbers.

When you finish or pause work on a ticket:
1. Pick the job with list_jobs (jobs are the booking target; the ticket is just a reference stored on the entry).
2. Call report_time with jobNumber, hours (decimal, e.g. 1.5), a concise one-line description, the ticket key and your name as reportedBy.
3. Book each piece of work once. Fix mistakes with update_time_entry / delete_time_entry — don't re-report.

Descriptions are ONE short line (aim for <80 chars): what was done, not how. No commit logs, file/function lists, MR or commit numbers, test counts or multi-clause summaries. Good: "Hängender Einzug für mehrzeilige Footer-Links". Don't repeat the ticket key — the report prepends it. Put #tags in the description to tag the entry.

Use get_weekly_report to review a week.`;

// ---------------------------------------------------------------------------
// Result helpers
// ---------------------------------------------------------------------------

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function fail(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}

/** Run a tool body and turn thrown errors into MCP error results the agent can read. */
async function run(fn: () => Promise<ReturnType<typeof ok>> | ReturnType<typeof ok>) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ConflictError || err instanceof ValidationError) {
      console.warn(`[zeff-mcp] ${err.name}: ${err.message}`);
    } else {
      console.error("[zeff-mcp]", err);
    }
    return fail(`Error: ${errorMessage(err)}`);
  }
}

function describeEntry(e: EntryWithJob): string {
  const parts = [
    `#${e.id}`,
    e.date,
    `${formatHours(e.hours)}h`,
    e.type,
    `${e.job.number} (${e.job.name})`,
    `"${e.description}"`,
  ];
  if (e.ticket) parts.push(`ticket ${e.ticket}`);
  if (e.tags.length) parts.push(`tags ${e.tags.map((t) => `#${t.name}`).join(" ")}`);
  parts.push(`by ${e.reportedBy}`);
  return parts.join(" · ");
}

function renderWeeklyReport(report: WeeklyReport): string {
  const { week } = report;
  const lines: string[] = [];
  lines.push(`# Zeff weekly report — ${week.key} (${formatWeekRange(week)})`);
  if (report.filter.reportedBy) {
    lines.push(`Filtered to entries reported by "${report.filter.reportedBy}".`);
  }
  lines.push("");

  if (report.rows.length === 0) {
    lines.push("_No time booked in this week._");
    return lines.join("\n");
  }

  const dayHeaders = week.days.map((d) => formatDay(d, "EEE d"));
  const cell = (h: number) => (h ? formatHours(h) : "");
  lines.push(`| Job | ${dayHeaders.join(" | ")} | Total |`);
  lines.push(`|---|${dayHeaders.map(() => "---:").join("|")}|---:|`);
  for (const row of report.rows) {
    lines.push(
      `| ${row.job.number} ${row.job.name} | ${row.hoursByDay.map(cell).join(" | ")} | **${formatHours(row.total)}** |`,
    );
  }
  lines.push(
    `| **Total** | ${report.dayTotals.map(cell).join(" | ")} | **${formatHours(report.total)}** |`,
  );
  lines.push("");
  lines.push(`## Entries (${report.entries.length})`);
  for (const e of report.entries) lines.push(`- ${describeEntry(e)}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export function registerZeffTools(server: McpServer): void {
  server.registerTool(
    "report_time",
    {
      title: "Report time",
      description:
        "Book hours on a job (one entry) with a concise one-line description of what was done. " +
        "jobNumber is optional if the ticket was booked before (its last job is reused); otherwise " +
        "see list_jobs. #tags in the description become the entry's tags.",
      inputSchema: z.object({
        jobNumber: z
          .string()
          .optional()
          .describe("Job number to book on (see list_jobs). Optional if the ticket was booked before."),
        hours: z
          .number()
          .positive()
          .max(24)
          .describe("Hours spent as a decimal, e.g. 0.25, 0.5, 1.5, 3."),
        description: z
          .string()
          .min(1)
          .describe(
            "What was done, as ONE short line (<80 chars); no commit logs, file lists or MR/commit numbers. " +
              "Don't repeat the ticket key. May contain #tags.",
          ),
        date: z
          .string()
          .optional()
          .describe("Date of the work as YYYY-MM-DD. Defaults to today."),
        ticket: z
          .string()
          .optional()
          .describe("Ticket / issue key the work belongs to, e.g. 'PROJ-337'."),
        type: z
          .enum(["ticket", "meeting", "other"])
          .optional()
          .describe("Kind of work. Defaults to 'ticket' when a ticket is given, else 'other'."),
        tags: z.array(z.string()).optional().describe("Tag names to attach."),
        reportedBy: z
          .string()
          .optional()
          .describe("Name of the agent or person reporting, e.g. 'Claude Code'. Defaults to 'agent'."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) =>
      run(() => {
        const jobNumber =
          args.jobNumber ??
          (args.ticket ? (getTicketDefaultJob(args.ticket) ?? getJobNumberForTicket(args.ticket)) : undefined);
        if (!jobNumber) {
          return fail(
            args.ticket
              ? `No job given and ticket "${args.ticket}" has not been booked before. Pass jobNumber (see list_jobs).`
              : "No jobNumber given. Pass jobNumber (see list_jobs).",
          );
        }
        const entry = createEntry(
          {
            jobNumber,
            hours: args.hours,
            description: args.description,
            date: args.date ?? todayIso(),
            ticket: args.ticket,
            type: args.type,
            tags: args.tags,
            reportedBy: args.reportedBy,
          },
          "mcp",
        );
        const week = weekFromDate(new Date(entry.date + "T00:00:00"));
        const weekTotal = getJobHours(entry.jobId, week.startIso, week.endIso);
        return ok(
          `Booked ${formatHours(entry.hours)}h on job ${entry.job.number} (${entry.job.name}) for ${entry.date}` +
            (entry.ticket ? `, ticket ${entry.ticket}` : "") +
            `. Entry id: ${entry.id}. ` +
            `This job now has ${formatHours(weekTotal)}h in week ${week.key}.`,
        );
      }),
  );

  server.registerTool(
    "list_jobs",
    {
      title: "List jobs",
      description:
        "List job numbers that time can be booked on, with total hours booked. " +
        "Optionally filter by a search term matching number, name or customer.",
      inputSchema: z.object({
        query: z.string().optional().describe("Search term (matches number, name, customer)."),
        includeInactive: z
          .boolean()
          .optional()
          .describe("Also list inactive (closed) jobs. Default false."),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) =>
      run(() => {
        const jobs = listJobs({ query: args.query, includeInactive: args.includeInactive });
        if (jobs.length === 0) {
          return ok(
            args.query
              ? `No jobs match "${args.query}".`
              : "No jobs exist yet. Create one with create_job or in the Zeff web UI.",
          );
        }
        const lines = jobs.map(
          (j) =>
            `- ${j.number} — ${j.name}` +
            (j.customer ? ` (${j.customer})` : "") +
            (j.active ? "" : " [inactive]") +
            ` · ${formatHours(j.totalHours)}h in ${j.entryCount} entries` +
            (j.description ? `\n  ${j.description}` : ""),
        );
        return ok(`${jobs.length} job(s):\n${lines.join("\n")}`);
      }),
  );

  server.registerTool(
    "create_job",
    {
      title: "Create job",
      description: "Create a new job number that time can be booked on.",
      inputSchema: z.object({
        number: z.string().min(1).describe("Unique job number, e.g. '2026-0815'."),
        name: z.string().min(1).describe("Short job name."),
        customer: z.string().optional().describe("Customer / client name."),
        description: z.string().optional().describe("Longer description of the job."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) =>
      run(() => {
        const job = createJob(args);
        return ok(`Created job ${job.number} — ${job.name} (id ${job.id}).`);
      }),
  );

  server.registerTool(
    "get_weekly_report",
    {
      title: "Weekly report",
      description:
        "Hours per job and weekday for one calendar week (Monday–Sunday), plus all entries of that week.",
      inputSchema: z.object({
        week: z
          .string()
          .optional()
          .describe(
            "ISO week like '2026-W39', or any date (YYYY-MM-DD) inside the week. Defaults to the current week.",
          ),
        reportedBy: z.string().optional().describe("Only include entries reported by this name."),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) =>
      run(() => {
        const week = resolveWeek(args.week);
        if (!week) {
          return fail(`Cannot parse week "${args.week}". Use '2026-W39' or a date like 2026-09-21.`);
        }
        return ok(renderWeeklyReport(getWeeklyReport(week, { reportedBy: args.reportedBy })));
      }),
  );

  server.registerTool(
    "list_time_entries",
    {
      title: "List time entries",
      description: "List booked time entries, newest first, with optional filters.",
      inputSchema: z.object({
        jobNumber: z.string().optional().describe("Only entries on this job."),
        from: z.string().optional().describe("Earliest date (YYYY-MM-DD), inclusive."),
        to: z.string().optional().describe("Latest date (YYYY-MM-DD), inclusive."),
        ticket: z.string().optional().describe("Only entries with this ticket key."),
        reportedBy: z.string().optional().describe("Only entries reported by this name."),
        limit: z.number().int().positive().max(500).optional().describe("Max entries, default 50."),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) =>
      run(() => {
        const entries = listEntries({ ...args, limit: args.limit ?? 50 });
        if (entries.length === 0) return ok("No matching time entries.");
        const total = entries.reduce((a, e) => a + e.hours, 0);
        return ok(
          `${entries.length} entries, ${formatHours(total)}h total:\n` +
            entries.map((e) => `- ${describeEntry(e)}`).join("\n"),
        );
      }),
  );

  server.registerTool(
    "update_time_entry",
    {
      title: "Update time entry",
      description: "Correct an existing time entry. Only the given fields are changed.",
      inputSchema: z.object({
        id: z.number().int().positive().describe("Entry id (from report_time or list_time_entries)."),
        jobNumber: z.string().optional(),
        hours: z.number().positive().max(24).optional(),
        description: z.string().min(1).optional(),
        date: z.string().optional().describe("YYYY-MM-DD"),
        ticket: z.string().nullable().optional().describe("Ticket key; null clears it."),
        type: z.enum(["ticket", "meeting", "other"]).optional(),
        tags: z.array(z.string()).optional().describe("Replaces the entry's tags."),
        reportedBy: z.string().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ id, ...patch }) => run(() => ok(`Updated: ${describeEntry(updateEntry(id, patch))}`)),
  );

  server.registerTool(
    "delete_time_entry",
    {
      title: "Delete time entry",
      description: "Delete a time entry that was booked by mistake.",
      inputSchema: z.object({
        id: z.number().int().positive().describe("Entry id to delete."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ id }) => run(() => ok(`Deleted: ${describeEntry(deleteEntry(id))}`)),
  );
}
