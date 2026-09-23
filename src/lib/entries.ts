import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { EntryType, Job, TimeEntry } from "@/db/schema";
import { NotFoundError, ValidationError } from "./errors";
import { round2 } from "./format";
import { requireJobByNumber } from "./jobs";
import { getOrCreateTags, getTagsForEntries, setEntryTags } from "./tags";
import { dedupeTags, extractHashtags, type TagLite } from "./tags-shared";
import {
  formatZodError,
  timeEntryInputSchema,
  timeEntryPatchSchema,
  type TimeEntryInput,
  type TimeEntryPatch,
} from "./validation";
import { isoDate, type WeekInfo } from "./week";

const { jobs, timeEntries } = schema;

export type JobRef = Pick<Job, "id" | "number" | "name" | "customer" | "active">;

export type EntryWithJob = TimeEntry & { job: JobRef; tags: TagLite[] };

export type ListEntriesOptions = {
  jobId?: number;
  jobNumber?: string;
  /** Inclusive ISO date bounds. */
  from?: string;
  to?: string;
  ticket?: string;
  reportedBy?: string;
  limit?: number;
};

const jobRefColumns = {
  id: jobs.id,
  number: jobs.number,
  name: jobs.name,
  customer: jobs.customer,
  active: jobs.active,
};

function selectEntries() {
  return getDb()
    .select({ entry: timeEntries, job: jobRefColumns })
    .from(timeEntries)
    .innerJoin(jobs, eq(timeEntries.jobId, jobs.id));
}

function shape(row: { entry: TimeEntry; job: JobRef }): EntryWithJob {
  return { ...row.entry, job: row.job, tags: [] };
}

/** Batch-load and attach each entry's tags. */
function attachTags(entries: EntryWithJob[]): EntryWithJob[] {
  const byEntry = getTagsForEntries(entries.map((e) => e.id));
  for (const e of entries) e.tags = byEntry.get(e.id) ?? [];
  return entries;
}

export function listEntries(opts: ListEntriesOptions = {}): EntryWithJob[] {
  const conditions = [];
  let jobId = opts.jobId;
  if (opts.jobNumber) jobId = requireJobByNumber(opts.jobNumber).id;
  if (jobId !== undefined) conditions.push(eq(timeEntries.jobId, jobId));
  if (opts.from) conditions.push(gte(timeEntries.date, opts.from));
  if (opts.to) conditions.push(lte(timeEntries.date, opts.to));
  if (opts.ticket) conditions.push(sql`lower(${timeEntries.ticket}) = lower(${opts.ticket})`);
  if (opts.reportedBy) {
    conditions.push(sql`lower(${timeEntries.reportedBy}) = lower(${opts.reportedBy})`);
  }

  const q = selectEntries()
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(timeEntries.date), desc(timeEntries.id));
  const rows = opts.limit ? q.limit(opts.limit).all() : q.all();
  return attachTags(rows.map(shape));
}

export function getEntry(id: number): EntryWithJob | undefined {
  const row = selectEntries().where(eq(timeEntries.id, id)).get();
  return row ? attachTags([shape(row)])[0] : undefined;
}

export function requireEntry(id: number): EntryWithJob {
  const entry = getEntry(id);
  if (!entry) throw new NotFoundError(`Time entry #${id} not found.`);
  return entry;
}

export function createEntry(
  raw: TimeEntryInput,
  source: TimeEntry["source"],
  opts: { externalId?: string } = {},
): EntryWithJob {
  const parsed = timeEntryInputSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(formatZodError(parsed.error));
  const input = parsed.data;
  const job = requireJobByNumber(input.jobNumber);

  // Move any #tags in the description into the tag list, cleaning the text.
  const { text: description, tags: hashTags } = extractHashtags(input.description);
  const tagNames = dedupeTags([...(input.tags ?? []), ...hashTags]);
  const type: EntryType = input.type ?? defaultType(input.ticket, source);

  const inserted = getDb()
    .insert(timeEntries)
    .values({
      jobId: job.id,
      date: input.date,
      hours: round2(input.hours),
      description,
      type,
      ticket: input.ticket || null,
      reportedBy: input.reportedBy || (source === "mcp" ? "agent" : "web"),
      source,
      externalId: opts.externalId ?? null,
    })
    .returning()
    .get();
  if (tagNames.length) {
    setEntryTags(inserted.id, getOrCreateTags(tagNames).map((t) => t.id));
  }
  return requireEntry(inserted.id);
}

function defaultType(ticket: string | undefined, source: TimeEntry["source"]): EntryType {
  if (source === "calendar") return "meeting"; // imported meetings are always Meetings
  if (ticket) return "ticket";
  return "other";
}

export function updateEntry(id: number, raw: TimeEntryPatch): EntryWithJob {
  const parsed = timeEntryPatchSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(formatZodError(parsed.error));
  const patch = parsed.data;
  const existing = requireEntry(id);
  const jobId = patch.jobNumber !== undefined ? requireJobByNumber(patch.jobNumber).id : undefined;

  // Extract #tags from a new description, if one was given.
  let description = patch.description;
  let hashTags: string[] = [];
  if (patch.description !== undefined) {
    const parsedDesc = extractHashtags(patch.description);
    description = parsedDesc.text;
    hashTags = parsedDesc.tags;
  }

  getDb()
    .update(timeEntries)
    .set({
      ...(jobId !== undefined && { jobId }),
      ...(patch.date !== undefined && { date: patch.date }),
      ...(patch.hours !== undefined && { hours: round2(patch.hours) }),
      ...(description !== undefined && { description }),
      ...(patch.type !== undefined && { type: patch.type }),
      ...(patch.ticket !== undefined && { ticket: patch.ticket || null }),
      ...(patch.reportedBy !== undefined && { reportedBy: patch.reportedBy }),
      updatedAt: sql`(CURRENT_TIMESTAMP)`,
    })
    .where(eq(timeEntries.id, id))
    .run();

  // Tags: an explicit list replaces; otherwise merge any new #tags into the existing set.
  if (patch.tags !== undefined) {
    const names = dedupeTags([...patch.tags, ...hashTags]);
    setEntryTags(id, getOrCreateTags(names).map((t) => t.id));
  } else if (hashTags.length) {
    const names = dedupeTags([...existing.tags.map((t) => t.name), ...hashTags]);
    setEntryTags(id, getOrCreateTags(names).map((t) => t.id));
  }
  return requireEntry(id);
}

export function deleteEntry(id: number): EntryWithJob {
  const entry = requireEntry(id);
  getDb().delete(timeEntries).where(eq(timeEntries.id, id)).run();
  return entry;
}

/** Which of the given calendar event ids already have a time entry. */
export function findImportedExternalIds(ids: string[]): Set<string> {
  if (ids.length === 0) return new Set();
  const rows = getDb()
    .select({ externalId: timeEntries.externalId })
    .from(timeEntries)
    .where(inArray(timeEntries.externalId, ids))
    .all();
  return new Set(rows.map((r) => r.externalId).filter((x): x is string => x !== null));
}

/**
 * The job number a ticket was most recently booked on, so automated bookings of
 * the same ticket reuse the same job.
 */
export function getJobNumberForTicket(ticket: string): string | undefined {
  const t = ticket.trim();
  if (!t) return undefined;
  const row = getDb()
    .select({ number: jobs.number })
    .from(timeEntries)
    .innerJoin(jobs, eq(jobs.id, timeEntries.jobId))
    .where(sql`lower(${timeEntries.ticket}) = lower(${t})`)
    .orderBy(desc(timeEntries.date), desc(timeEntries.id))
    .limit(1)
    .get();
  return row?.number;
}

export type TicketSuggestion = {
  ticket: string;
  jobId: number;
  jobNumber: string;
  jobName: string;
  description: string;
  /** Jira assignee display name, and whether it's the current user (from the Jira sync). */
  assignee?: string | null;
  mine?: boolean;
};

/** Distinct tickets that have entries within the week, newest first per ticket. */
export function listWeekTickets(week: WeekInfo): TicketSuggestion[] {
  const entries = listEntries({ from: week.startIso, to: week.endIso });
  const seen = new Set<string>();
  const out: TicketSuggestion[] = [];
  for (const e of entries) {
    // listEntries is ordered date desc, id desc, so the first hit per ticket is newest.
    if (!e.ticket) continue;
    const key = e.ticket.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      ticket: e.ticket,
      jobId: e.job.id,
      jobNumber: e.job.number,
      jobName: e.job.name,
      description: e.description,
    });
  }
  return out.sort((a, b) => a.ticket.localeCompare(b.ticket, undefined, { numeric: true }));
}

/** Earliest booked entry date (YYYY-MM-DD), or undefined when there are none. */
export function getEarliestEntryDate(): string | undefined {
  const row = getDb()
    .select({ d: sql<string | null>`min(${timeEntries.date})` })
    .from(timeEntries)
    .get();
  return row?.d ?? undefined;
}

/** Sum of hours booked on a job, optionally limited to an inclusive date range. */
export function getJobHours(jobId: number, from?: string, to?: string): number {
  const conditions = [eq(timeEntries.jobId, jobId)];
  if (from) conditions.push(gte(timeEntries.date, from));
  if (to) conditions.push(lte(timeEntries.date, to));
  const row = getDb()
    .select({ total: sql<number>`coalesce(sum(${timeEntries.hours}), 0)` })
    .from(timeEntries)
    .where(and(...conditions))
    .get();
  return round2(Number(row?.total ?? 0));
}

// ---------------------------------------------------------------------------
// Weekly report
// ---------------------------------------------------------------------------

export type WeeklyReportRow = {
  job: JobRef;
  /** Hours per weekday, index 0 = Monday … 6 = Sunday. */
  hoursByDay: number[];
  total: number;
};

export type WeeklyReport = {
  week: WeekInfo;
  rows: WeeklyReportRow[];
  /** Totals per weekday, index 0 = Monday … 6 = Sunday. */
  dayTotals: number[];
  total: number;
  /** All entries of the week, newest first. */
  entries: EntryWithJob[];
  /** Distinct reporters that booked time this week. */
  reporters: string[];
  filter: { reportedBy?: string };
};

export function getWeeklyReport(
  week: WeekInfo,
  filter: { reportedBy?: string } = {},
): WeeklyReport {
  const entries = listEntries({
    from: week.startIso,
    to: week.endIso,
    reportedBy: filter.reportedBy,
  });

  const dayIndex = new Map(week.days.map((d, i) => [isoDate(d), i]));
  const byJob = new Map<number, WeeklyReportRow>();
  const dayTotals = Array(7).fill(0) as number[];
  const reporters = new Set<string>();

  for (const e of entries) {
    const idx = dayIndex.get(e.date);
    if (idx === undefined) continue;
    let row = byJob.get(e.jobId);
    if (!row) {
      row = { job: e.job, hoursByDay: Array(7).fill(0) as number[], total: 0 };
      byJob.set(e.jobId, row);
    }
    row.hoursByDay[idx] = round2(row.hoursByDay[idx] + e.hours);
    row.total = round2(row.total + e.hours);
    dayTotals[idx] = round2(dayTotals[idx] + e.hours);
    reporters.add(e.reportedBy);
  }

  const rows = [...byJob.values()].sort((a, b) =>
    a.job.number.localeCompare(b.job.number, undefined, { numeric: true }),
  );
  const total = round2(dayTotals.reduce((a, b) => a + b, 0));

  return {
    week,
    rows,
    dayTotals,
    total,
    entries,
    reporters: [...reporters].sort(),
    filter,
  };
}

/** Distinct reporter names across all entries (for filters / dropdowns). */
export function listReporters(): string[] {
  return getDb()
    .selectDistinct({ reportedBy: timeEntries.reportedBy })
    .from(timeEntries)
    .orderBy(timeEntries.reportedBy)
    .all()
    .map((r) => r.reportedBy);
}

