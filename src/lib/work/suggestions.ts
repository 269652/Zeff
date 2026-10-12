import { and, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { EntrySuggestion } from "@/db/schema";
import { todosByIds } from "@/lib/boards/store";
import { todoRef } from "@/lib/boards/shared";
import { emitChange } from "@/lib/events";
import { createEntry, getJobNumberForTicket } from "@/lib/entries";
import { ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { round2 } from "@/lib/format";
import { getTicketDefaultJob } from "@/lib/jira/store";
import { getJobByNumber } from "@/lib/jobs";
import { getProject } from "@/lib/projects";
import { isoDate } from "@/lib/week";
import { attachTodoContext } from "./booking";
import { workRef, type TimeRecord } from "./shared";
import { listTodoTimes, markTimeBooked, markTimeSuggested, timesByIds } from "./todo-time";

const { entrySuggestions, workRuns, todos } = schema;

/** A suggested booking as the Weekly report shows it: a shadow row, with its evidence. */
export type SuggestionView = {
  id: number;
  ref: string;
  date: string;
  hours: number;
  description: string;
  ticket: string | null;
  /** The job it would go on (asked for, the project's, else the ticket's) — null: none yet. */
  job: { id: number; number: string; name: string } | null;
  project: { id: number; title: string } | null;
  reportedBy: string;
  status: "open" | "accepted" | "skipped";
  entryId: number | null;
  createdAt: string;
  /** Evidence: the todos the work was on… */
  todos: { id: number; ref: string; text: string; status: string }[];
  /** …the time records it adds up (what the agents reported on them)… */
  times: TimeRecord[];
  /** …and the work runs it books (who, how long, what they reported). */
  runs: { id: number; ref: string; agent: string; minutes: number | null; outcome: string | null; entryLine: string | null; summary: string | null; startedAt: string | null; finishedAt: string | null }[];
};

export const suggestionRef = (id: number) => `S-${id}`;
/** "S-12" or "12" → 12. */
export const parseSuggestionRef = (v: string | number) => {
  const n = Number(String(v).trim().replace(/^S-/i, ""));
  return Number.isInteger(n) && n > 0 ? n : null;
};

const ids = (json: string) => {
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? v.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
  } catch {
    return [];
  }
};

/** One line: the first, trimmed, at most 200 characters. */
const oneLine = (s: string) => {
  const line = s.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
  return line.length > 200 ? `${line.slice(0, 199)}…` : line;
};

/** Booked time: quarter hours, rounded up — at least one. */
export const quarterHours = (ms: number) => Math.max(0.25, Math.ceil(ms / 900000) * 0.25);

/** The job a suggestion goes on: the one asked for, else the ticket's (its board's, or the last booked). */
function jobOf(s: Pick<EntrySuggestion, "jobNumber" | "projectId" | "ticket">) {
  if (s.projectId) return null;
  const number = s.jobNumber ?? (s.ticket ? (getTicketDefaultJob(s.ticket) ?? getJobNumberForTicket(s.ticket)) : undefined);
  const job = number ? getJobByNumber(number) : undefined;
  return job ? { id: job.id, number: job.number, name: job.name } : null;
}

function toView(r: EntrySuggestion): SuggestionView {
  const todoIds = ids(r.todoIds);
  const runIds = ids(r.runIds);
  const ts = todosByIds(todoIds);
  const times = timesByIds(ids(r.timeIds));
  // Only what's shown — not a run's prompt, result and git summary (large).
  const runs = runIds.length
    ? getDb()
        .select({ id: workRuns.id, model: workRuns.model, provider: workRuns.provider, durationMs: workRuns.durationMs, outcome: workRuns.outcome, entryLine: workRuns.entryLine, summary: workRuns.summary, startedAt: workRuns.startedAt, finishedAt: workRuns.finishedAt })
        .from(workRuns)
        .where(inArray(workRuns.id, runIds))
        .all()
    : [];
  const project = r.projectId ? getProject(r.projectId) : undefined;
  return {
    id: r.id,
    ref: suggestionRef(r.id),
    date: r.date,
    hours: r.hours,
    description: r.description,
    ticket: r.ticket,
    job: jobOf(r),
    project: project ? { id: project.id, title: project.title } : null,
    reportedBy: r.reportedBy,
    status: r.status === "accepted" || r.status === "skipped" ? r.status : "open",
    entryId: r.entryId,
    createdAt: r.createdAt,
    todos: todoIds.flatMap((id) => {
      const todo = ts.get(id);
      return todo ? [{ id, ref: todoRef(id), text: todo.text, status: todo.status }] : [];
    }),
    times,
    runs: runs
      .sort((a, b) => (a.startedAt ?? "").localeCompare(b.startedAt ?? ""))
      .map((w) => ({
        id: w.id,
        ref: workRef(w.id),
        agent: w.model ?? w.provider,
        minutes: w.durationMs ? Math.round(w.durationMs / 60000) : null,
        outcome: w.outcome,
        entryLine: w.entryLine,
        summary: w.summary,
        startedAt: w.startedAt,
        finishedAt: w.finishedAt,
      })),
  };
}

/** The todos and runs some suggestion has already (open, taken over or skipped) — not suggested again. */
export function suggestedEvidence(): { todoIds: Set<number>; runIds: Set<number>; timeIds: Set<number> } {
  const rows = getDb().select({ todoIds: entrySuggestions.todoIds, runIds: entrySuggestions.runIds, timeIds: entrySuggestions.timeIds }).from(entrySuggestions).all();
  return { todoIds: new Set(rows.flatMap((r) => ids(r.todoIds))), runIds: new Set(rows.flatMap((r) => ids(r.runIds))), timeIds: new Set(rows.flatMap((r) => ids(r.timeIds))) };
}

/** The finished runs on these todos that no booking or suggestion has yet — the work a new suggestion books. */
export function unsuggestedRuns(todoIds: number[]): number[] {
  if (!todoIds.length) return [];
  const taken = suggestedEvidence().runIds;
  return getDb()
    .select({ id: workRuns.id })
    .from(workRuns)
    .where(and(inArray(workRuns.todoId, todoIds), eq(workRuns.status, "done"), isNull(workRuns.entryId)))
    .all()
    .map((r) => r.id)
    .filter((id) => !taken.has(id));
}

/** The time records on these todos that no booking or suggestion has yet. */
export function unsuggestedTimes(todoIds: number[]): number[] {
  const taken = suggestedEvidence().timeIds;
  return listTodoTimes(todoIds, { open: true }).map((r) => r.id).filter((id) => !taken.has(id));
}

/**
 * An agent's booking, as a suggestion (nothing is booked): a shadow row in the Weekly report
 * until you take it over. Its evidence: the todos named and their runs not booked yet.
 */
export function suggestEntry(v: {
  date?: string;
  hours: number;
  description: string;
  ticket?: string | null;
  jobNumber?: string | null;
  projectId?: number | null;
  type?: string | null;
  tags?: string[];
  reportedBy?: string | null;
  todoIds?: number[];
  runIds?: number[];
  timeIds?: number[];
}): SuggestionView {
  const hours = round2(Number(v.hours));
  if (!(hours > 0) || hours > 24) throw new ValidationError(t("Hours: more than 0, at most 24."));
  const description = oneLine(v.description ?? "");
  if (!description) throw new ValidationError(t("A description (one line) is needed."));
  const date = v.date?.trim() || isoDate(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ValidationError(t("Date: YYYY-MM-DD."));
  const todoIds = [...new Set((v.todoIds ?? []).filter((n) => Number.isInteger(n)))];
  const runIds = [...new Set([...(v.runIds ?? []), ...unsuggestedRuns(todoIds)])];
  const timeIds = [...new Set([...(v.timeIds ?? []), ...unsuggestedTimes(todoIds)])];
  const now = new Date().toISOString();
  const row = getDb()
    .insert(entrySuggestions)
    .values({
      date,
      hours,
      description,
      ticket: v.ticket?.trim().toUpperCase() || null,
      jobNumber: v.jobNumber?.trim() || null,
      projectId: v.projectId ?? null,
      type: v.type?.trim() || null,
      tags: JSON.stringify(v.tags ?? []),
      reportedBy: v.reportedBy?.trim() || "agent",
      todoIds: JSON.stringify(todoIds),
      runIds: JSON.stringify(runIds),
      timeIds: JSON.stringify(timeIds),
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  markTimeSuggested(timeIds, row.id);
  emitChange("work");
  return toView(row);
}

export function getSuggestion(id: number): SuggestionView | undefined {
  const r = getDb().select().from(entrySuggestions).where(eq(entrySuggestions.id, id)).get();
  return r ? toView(r) : undefined;
}

/** The open suggestions, oldest day first — the shadow rows to take over. */
export function openSuggestions(): SuggestionView[] {
  return getDb()
    .select()
    .from(entrySuggestions)
    .where(eq(entrySuggestions.status, "open"))
    .orderBy(entrySuggestions.date, entrySuggestions.id)
    .all()
    .map(toView);
}

/** How many suggestions are open in a period (YYYY-MM-DD, inclusive) and their hours — counted, not built. */
export function openSuggestionTotals(from: string, to: string): { count: number; hours: number } {
  const r = getDb()
    .select({ count: sql<number>`count(*)`, hours: sql<number>`coalesce(sum(${entrySuggestions.hours}), 0)` })
    .from(entrySuggestions)
    .where(and(eq(entrySuggestions.status, "open"), gte(entrySuggestions.date, from), lte(entrySuggestions.date, to)))
    .get();
  return { count: Number(r?.count ?? 0), hours: Number(r?.hours ?? 0) };
}

function requireOpen(id: number): EntrySuggestion {
  const r = getDb().select().from(entrySuggestions).where(eq(entrySuggestions.id, id)).get();
  const ref = suggestionRef(id);
  if (!r) throw new ValidationError(t("{ref} doesn't exist.", { ref }));
  if (r.status === "accepted") throw new ValidationError(t("{ref} is taken over (a booked entry) already — it can't be changed any more.", { ref }));
  if (r.status !== "open") throw new ValidationError(t("{ref} is skipped — it can't be changed any more.", { ref }));
  return r;
}

/** Change an open suggestion (the agent correcting itself). */
export function updateSuggestion(
  id: number,
  patch: { date?: string; hours?: number; description?: string; ticket?: string | null; jobNumber?: string | null; projectId?: number | null; type?: string | null; tags?: string[] },
): SuggestionView {
  requireOpen(id);
  const set: Partial<EntrySuggestion> = { updatedAt: new Date().toISOString() };
  if (patch.hours !== undefined) {
    const h = round2(Number(patch.hours));
    if (!(h > 0) || h > 24) throw new ValidationError(t("Hours: more than 0, at most 24."));
    set.hours = h;
  }
  if (patch.description !== undefined) {
    const d = oneLine(patch.description);
    if (!d) throw new ValidationError(t("A description (one line) is needed."));
    set.description = d;
  }
  if (patch.date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(patch.date)) throw new ValidationError(t("Date: YYYY-MM-DD."));
    set.date = patch.date;
  }
  if (patch.ticket !== undefined) set.ticket = patch.ticket?.trim().toUpperCase() || null;
  if (patch.jobNumber !== undefined) set.jobNumber = patch.jobNumber?.trim() || null;
  if (patch.projectId !== undefined) set.projectId = patch.projectId;
  if (patch.type !== undefined) set.type = patch.type?.trim() || null;
  if (patch.tags !== undefined) set.tags = JSON.stringify(patch.tags);
  getDb().update(entrySuggestions).set(set).where(eq(entrySuggestions.id, id)).run();
  emitChange("work");
  return getSuggestion(id)!;
}

/** Take an open suggestion back (made by mistake) — it's gone, its evidence free again. */
export function withdrawSuggestion(id: number): SuggestionView {
  const row = requireOpen(id);
  const view = toView(row);
  markTimeSuggested(ids(row.timeIds), null);
  getDb().delete(entrySuggestions).where(eq(entrySuggestions.id, id)).run();
  emitChange("work");
  return view;
}

/** Not to be booked: skipped (its evidence isn't suggested again). */
export function skipSuggestion(id: number): void {
  requireOpen(id);
  getDb().update(entrySuggestions).set({ status: "skipped", updatedAt: new Date().toISOString() }).where(eq(entrySuggestions.id, id)).run();
  emitChange("work");
}

/**
 * Take a suggestion over — with the hours and words you settled on: a real entry (by the agent,
 * source mcp), its evidence as the entry's context (the todos, what they came from, the MRs),
 * its todos and runs booked with it.
 */
export function acceptSuggestion(id: number, edits: { hours?: number; description?: string } = {}, opts: { context?: boolean } = {}): { entryId: number; hours: number; ticket: string | null; todoIds: number[] } {
  const r = requireOpen(id);
  const job = jobOf(r);
  if (!job && !r.projectId) {
    throw new ValidationError(r.ticket ? t("{ticket} has no job — give it (or its board) one on the Jira tab.", { ticket: r.ticket }) : t("No job to book on."));
  }
  const hours = edits.hours !== undefined ? round2(Number(edits.hours)) : r.hours;
  if (!(hours > 0) || hours > 24) throw new ValidationError(t("Hours: more than 0, at most 24."));
  const description = (edits.description !== undefined ? oneLine(edits.description) : "") || r.description;
  let tags: string[] = [];
  try {
    tags = JSON.parse(r.tags) as string[];
  } catch {
    tags = [];
  }
  const entry = createEntry(
    {
      jobNumber: r.projectId ? undefined : job!.number,
      projectId: r.projectId ?? undefined,
      date: r.date,
      hours,
      description,
      ticket: r.ticket ?? undefined,
      type: r.type ?? undefined,
      tags,
      reportedBy: r.reportedBy,
    },
    "mcp",
  );
  const todoIds = ids(r.todoIds);
  const runIds = ids(r.runIds);
  markTimeBooked(ids(r.timeIds), entry.id);
  if (todoIds.length) {
    getDb().update(todos).set({ entryId: entry.id }).where(and(inArray(todos.id, todoIds), isNull(todos.entryId))).run();
    // Its context: here, or (context: false) by the caller once the booking is answered.
    if (opts.context !== false) attachTodoContext(entry.id, r.ticket, todoIds);
  }
  if (runIds.length) getDb().update(workRuns).set({ entryId: entry.id }).where(and(inArray(workRuns.id, runIds), isNull(workRuns.entryId))).run();
  getDb().update(entrySuggestions).set({ status: "accepted", entryId: entry.id, hours, description, updatedAt: new Date().toISOString() }).where(eq(entrySuggestions.id, id)).run();
  emitChange("work");
  return { entryId: entry.id, hours, ticket: r.ticket, todoIds };
}
