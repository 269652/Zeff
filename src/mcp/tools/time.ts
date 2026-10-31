import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { getJobNumberForTicket, getWeeklyReport, listEntries } from "@/lib/entries";
import { attributed } from "@/lib/todos/activity";
import { getTodo, markWorkerDone } from "@/lib/todos/store";
import { parseTodoRef, todoRef } from "@/lib/todos/shared";
import { formatHours } from "@/lib/format";
import { getTicketDefaultJob } from "@/lib/jira/store";
import { createJob, listJobs } from "@/lib/jobs";
import { listProjects, requireProjectByTitle } from "@/lib/projects";
import { resolveWeek, todayIso } from "@/lib/week";
import { SESSION_LOG, run, fail, recordFromLog, ok, renderWeeklyReport, describeEntry } from "./kit";

/** Registers report_time: a booking suggested from the time measured on todos. */
export function registerReportTimeTool(server: McpServer): void {
  server.registerTool(
    "report_time",
    {
      title: "Report time",
      description:
        "Suggest a booking (one entry) of the time MEASURED on the todos you name (their clocks' records not suggested yet — you give no hours), " +
        "with ONE concise line of what was done — it becomes a suggestion (S-<id>), " +
        "a shadow row the user takes over in Zeff; nothing is booked directly. Name the todos the work was on: their runs, " +
        "logs and sources become its evidence. jobNumber is optional if the ticket has a job (its board's, or the last booked); " +
        "otherwise see list_jobs. #tags in the description become the entry's tags.",
      inputSchema: z.object({
        jobNumber: z
          .string()
          .optional()
          .describe("Job number to book on (see list_jobs). Optional if the ticket was booked before."),
        project: z
          .string()
          .optional()
          .describe("Project title to book on instead of a job (see list_projects); the project's job is used."),
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
          .string()
          .optional()
          .describe(
            "Kind of work, an entry type key: ticket, meeting, internal, training, other, absence — or one the user added in Zeff. " +
              "When omitted, the user's type rules decide (e.g. an absence job → 'absence'), else 'ticket' when a ticket is given, else 'other'.",
          ),
        tags: z.array(z.string()).optional().describe("Tag names to attach."),
        reportedBy: z
          .string()
          .optional()
          .describe("Name of the agent or person reporting, e.g. 'Claude Code'. Defaults to 'agent'."),
        todos: z
          .array(z.string())
          .min(1)
          .describe("Board todos this work was on and finished, e.g. ['T-12'] (see list_todos) — their measured time is the suggestion's hours, they its evidence; they're reported done with it (highlighted, the user closes them)."),
        log: SESSION_LOG,
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) =>
      run(async () => {
        // A project books on its own job; otherwise the given job, else the ticket's last one.
        const projectId = args.project ? requireProjectByTitle(args.project).id : undefined;
        const jobNumber =
          projectId !== undefined
            ? undefined
            : (args.jobNumber ??
              (args.ticket ? (getTicketDefaultJob(args.ticket) ?? getJobNumberForTicket(args.ticket)) : undefined));
        if (!jobNumber && projectId === undefined) {
          return fail(
            args.ticket
              ? `No job given and ticket "${args.ticket}" has no job yet. Pass jobNumber (see list_jobs) or project (see list_projects).`
              : "No jobNumber given. Pass jobNumber (see list_jobs) or project (see list_projects).",
          );
        }
        const known: number[] = [];
        const unknown: string[] = [];
        for (const ref of args.todos ?? []) {
          const id = parseTodoRef(ref);
          if (id === null || !getTodo(id)) unknown.push(ref);
          else known.push(id);
        }
        // Only measured time: the hours are the records the todos' clocks made (not suggested yet) — the agent gives none.
        const { listTodoTimes } = await import("@/lib/work/todo-time");
        const { formatMinutes } = await import("@/lib/work/shared");
        const { quarterHours, suggestedEvidence } = await import("@/lib/work/suggestions");
        const taken = suggestedEvidence().timeIds;
        // Work no clock measured: the agent's log of it (times it read) becomes a record on the first todo first.
        if (args.log && known.length) await recordFromLog(known[0], args.log, args.description, args.reportedBy);
        const reported = listTodoTimes(known, { open: true }).filter((r) => !taken.has(r.id));
        const measured = reported.reduce((a, r) => a + r.minutes, 0);
        if (!measured) {
          return fail(
            `No measured time on ${known.length ? known.map((id) => todoRef(id)).join(", ") : args.todos.join(", ")} — only measured time is booked. ` +
              "Worked without a clock? Call again with your log: log: { from, to } — times you READ (your session's messages, or date -u +%FT%TZ), or log.steps; Zeff computes the minutes. Next time start a clock first (start_todo or todo_clock_start).",
          );
        }
        // A suggestion, not a booking: the user takes it over in Zeff (with its evidence).
        const { suggestEntry } = await import("@/lib/work/suggestions");
        const s = suggestEntry({
          jobNumber: projectId === undefined ? jobNumber : null,
          projectId: projectId ?? null,
          hours: quarterHours(measured * 60000),
          description: args.description,
          date: args.date ?? todayIso(),
          ticket: args.ticket,
          type: args.type,
          tags: args.tags,
          reportedBy: args.reportedBy ?? "agent",
          todoIds: known,
        });
        // The todos this work finished: reported done (highlighted, still open — the user closes them), with the suggestion as the reason.
        const closed: string[] = [];
        for (const id of known) {
          const t = getTodo(id);
          if (t?.status !== "open") continue;
          attributed(`agent:${s.reportedBy || "MCP"}`, () => markWorkerDone(id, s.reportedBy || "MCP", `Entry suggested ${s.ref} (${s.date}, ${formatHours(s.hours)} h): ${s.description}`));
          closed.push(todoRef(id));
        }
        return ok(
          `Suggested ${s.ref}: ${formatHours(s.hours)}h` +
            (s.project ? ` on project "${s.project.title}"` : s.job ? ` on job ${s.job.number} (${s.job.name})` : "") +
            ` for ${s.date}` +
            (s.ticket ? `, ticket ${s.ticket}` : "") +
            ` — "${s.description}". Not booked: the user takes it over in Zeff.` +
            (s.todos.length || s.runs.length ? ` Evidence: ${[...s.todos.map((t) => t.ref), ...s.runs.map((r) => r.ref)].join(", ")}.` : "") +
            (closed.length ? ` Reported done (still open for you to close): ${closed.join(", ")}.` : "") +
            ` Measured: ${formatMinutes(measured)} in ${reported.length} record(s) on ${[...new Set(reported.map((r) => r.todo))].join(", ")} (to the next quarter hour).` +
            (unknown.length ? ` Unknown todos (not linked): ${unknown.join(", ")}.` : ""),
        );
      }),
  );
}

/** Registers list_jobs, list_projects, create_job, get_weekly_report, list_time_entries, update/delete_time_entry. */
export function registerBookingTools(server: McpServer): void {
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
    "list_projects",
    {
      title: "List projects",
      description:
        "List projects time can be booked on (report_time with project). A project books its hours on its job; " +
        "one without a job collects them under a placeholder until the user sets it.",
      inputSchema: z.object({
        includeInactive: z.boolean().optional().describe("Also list inactive projects. Default false."),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) =>
      run(() => {
        const projects = listProjects({ includeInactive: args.includeInactive });
        if (projects.length === 0) return ok("No projects exist yet. They are created in the Zeff web UI (Projects).");
        const lines = projects.map(
          (p) =>
            `- "${p.title}" → ` +
            (p.job ? `job ${p.job.number} (${p.job.name})` : "no job yet") +
            (p.active ? "" : " [inactive]") +
            ` · ${formatHours(p.totalHours)}h in ${p.entryCount} entries` +
            (p.description ? `\n  ${p.description}` : ""),
        );
        return ok(`${projects.length} project(s):\n${lines.join("\n")}`);
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
      title: "Update time suggestion",
      description: "Correct a booking you suggested (S-<id>, from report_time or finish_todo) while it's still open — booked entries are the user's. Only the given fields are changed; hours only lower (they're measured time).",
      inputSchema: z.object({
        id: z.union([z.number().int().positive(), z.string()]).describe("The suggestion: 'S-12' or 12."),
        jobNumber: z.string().optional().describe("Book on this job directly (takes the entry out of its project)."),
        project: z.string().nullable().optional().describe("Book on this project (by title); null takes the entry out of its project."),
        hours: z.number().positive().max(24).optional(),
        description: z.string().min(1).optional(),
        date: z.string().optional().describe("YYYY-MM-DD"),
        ticket: z.string().nullable().optional().describe("Ticket key; null clears it."),
        type: z.string().optional().describe("Entry type key, e.g. ticket, meeting, internal, training, other, absence."),
        tags: z.array(z.string()).optional().describe("Replaces the entry's tags."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ id, project, ...patch }) =>
      run(async () => {
        const { parseSuggestionRef, updateSuggestion } = await import("@/lib/work/suggestions");
        const n = parseSuggestionRef(id);
        if (n === null) return fail(`"${id}" isn't a suggestion (S-<id>).`);
        const projectId = project === undefined ? undefined : project === null ? null : requireProjectByTitle(project).id;
        // Its hours are measured time: lowered, never raised.
        const was = (await import("@/lib/work/suggestions")).getSuggestion(n);
        if (was && patch.hours !== undefined && patch.hours > was.hours) return fail(`${was.ref} has ${formatHours(was.hours)}h of measured time — its hours can only be lowered, never raised.`);
        const s = updateSuggestion(n, { ...patch, ...(projectId !== undefined && { projectId }) });
        return ok(`Updated ${s.ref}: ${formatHours(s.hours)}h for ${s.date}${s.ticket ? `, ${s.ticket}` : ""} — "${s.description}".`);
      }),
  );

  server.registerTool(
    "delete_time_entry",
    {
      title: "Withdraw time suggestion",
      description: "Withdraw a booking you suggested by mistake (S-<id>) while it's still open — booked entries are the user's.",
      inputSchema: z.object({
        id: z.union([z.number().int().positive(), z.string()]).describe("The suggestion: 'S-12' or 12."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ id }) =>
      run(async () => {
        const { parseSuggestionRef, withdrawSuggestion } = await import("@/lib/work/suggestions");
        const n = parseSuggestionRef(id);
        if (n === null) return fail(`"${id}" isn't a suggestion (S-<id>).`);
        const s = withdrawSuggestion(n);
        return ok(`Withdrew ${s.ref} (${formatHours(s.hours)}h, "${s.description}").`);
      }),
  );
}
