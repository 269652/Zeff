import { isInstalled } from "@/plugins/state";
import { z } from "zod";
import { ConflictError, NotFoundError, ValidationError, errorMessage } from "@/lib/errors";
import type { EntryWithJob, WeeklyReport } from "@/lib/entries";
import { getTodo } from "@/lib/boards/store";
import { formatHours } from "@/lib/format";
import { NO_JOB_NUMBER } from "@/lib/projects-shared";
import { formatDay, formatWeekRange } from "@/lib/week";
import type { TimeRecord } from "@/lib/work/shared";

// ---------------------------------------------------------------------------
// Result helpers (each tool answers through these)
// ---------------------------------------------------------------------------

/**
 * The agent's own log of a stretch, for when its clock went quiet (it didn't ping often enough): times it READ, never guessed
 * — Zeff works the time out from them (todo-clock.ts loggedMs).
 */
export const SESSION_LOG = z
  .object({
    steps: z
      .array(z.string())
      .optional()
      .describe("The times (ISO 8601) of your steps on this todo since the clock started — read from your session (each tool call's time), not estimated. Gaps over 10 minutes don't count."),
    from: z.string().optional().describe("When you began (ISO 8601) — read when you began: date -u +%FT%TZ, or new Date().toISOString()."),
    to: z.string().optional().describe("When you ended (ISO 8601) — read now the same way. Zeff counts to − from (never before the clock started)."),
    idle: z.boolean().optional().describe("true: you really weren't working on it after the clock's last sign of life — only what it measured counts."),
  })
  .optional()
  .describe("Only if you didn't ping the clock reliably: your own record of the stretch — times you READ (from your session, or taken with date/JS at start and end), never estimated. Zeff computes the minutes from them and takes the more of that and what the clock measured.");

/**
 * Work no clock measured (the agent didn't start one): its own log of it, as one time record on the todo — the minutes
 * worked out from the times it READ (todo-clock.ts loggedMs), never before the todo's last record or before it was made,
 * never in the future. The note says it came from the log. Null: the log gives no time.
 */
export async function recordFromLog(todoId: number, log: z.infer<typeof SESSION_LOG>, note: string | undefined, agent: string | undefined): Promise<TimeRecord | null> {
  if (!log || log.idle) return null;
  const { loggedMs } = await import("@/lib/work/todo-clock");
  const { addTodoTime, listTodoTimes } = await import("@/lib/work/todo-time");
  const now = Date.now();
  const since = Math.max(0, ...listTodoTimes([todoId]).map((r) => Date.parse(r.at)), Date.parse(getTodo(todoId)?.createdAt ?? "") || 0);
  const ms = loggedMs(log, since, now);
  if (ms < 30000) return null;
  const hhmm = (v: string | undefined) => (v ? new Date(v).toISOString().slice(11, 16) : "");
  const span = log.steps?.length ? `${log.steps.length} steps` : `${hhmm(log.from)}–${hhmm(log.to)} UTC`;
  return addTodoTime({ todoId, minutes: Math.max(1, Math.round(ms / 60000)), note: `${note ? `${note} ` : ""}(from the agent's log, ${span})`, by: agent, source: "agent", at: new Date(now).toISOString() });
}

export function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

export function fail(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}

/** What a tool answers: text, and pictures (todo_attachment). */
export type ToolResult = { content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[]; isError?: boolean };

/** Run a tool body and turn thrown errors into MCP error results the agent can read. */
export async function run(fn: () => Promise<ToolResult> | ToolResult) {
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

export function describeEntry(e: EntryWithJob): string {
  const parts = [
    `#${e.id}`,
    e.date,
    `${formatHours(e.hours)}h`,
    e.type,
    `${e.job.number} (${e.job.name})`,
    `"${e.description}"`,
  ];
  if (e.project) parts.splice(5, 0, `project "${e.project.title}"`);
  if (e.ticket) parts.push(`ticket ${e.ticket}`);
  if (e.tags.length) parts.push(`tags ${e.tags.map((t) => `#${t.name}`).join(" ")}`);
  parts.push(`by ${e.reportedBy}`);
  return parts.join(" · ");
}

export function renderWeeklyReport(report: WeeklyReport): string {
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
    const label = row.project
      ? `${row.project.title} (project, ${row.job.number === NO_JOB_NUMBER ? "no job yet" : row.job.number})`
      : `${row.job.number} ${row.job.name}`;
    lines.push(
      `| ${label} | ${row.hoursByDay.map(cell).join(" | ")} | **${formatHours(row.total)}** |`,
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

/** A tool of a plugin that isn't installed: says so (else null). */
export function pluginOff(id: "todos" | "work") {
  if (isInstalled(id)) return null;
  return fail(`${id === "work" ? "Code" : "Todos"} is not installed in Zeff (Menu → Plugins) — this tool isn't available.`);
}
