import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { EntryType, Job, TimeEntry } from "@/db/schema";
import { jobForMeeting, type BookedEntry, type MeetingJobRule } from "./calendar/meetings";
import { defaultTagsFor } from "./default-tags";
import { beforeEntryDeleted, ensureHeadSpan, getSpan, recomputeSpan, releaseHead, setSpanMode, spanOfHead, unlinkMember } from "./entry-spans";
import { normalizeStart } from "./entry-timeline";
import { assertEntryType, isEntryType } from "./entry-types";
import { NotFoundError, ValidationError } from "./errors";
import { round2 } from "./format";
import { t } from "@/lib/i18n/server";
import { isNoJobPlaceholder, requireJobByNumber } from "./jobs";
import { projectBookingJob, requireProject } from "./projects";
import { getStoredReportRules } from "./report-rules";
import { ruleTags, type RuleEntry } from "./report-shared";
import { getOrCreateTags, getTagsForEntries, setEntryTags } from "./tags";
import { dedupeTags, extractHashtags, type TagLite } from "./tags-shared";
import { getTypeRules } from "./type-rules";
import { inferType } from "./type-rules-shared";
import {
  formatZodError,
  timeEntryInputSchema,
  timeEntryPatchSchema,
  type TimeEntryInput,
  type TimeEntryPatch,
} from "./validation";
import { isoDate, type WeekInfo } from "./week";

const { jobs, projects, timeEntries } = schema;

export type JobRef = Pick<Job, "id" | "number" | "name" | "customer" | "active">;

export type ProjectRef = { id: number; title: string };

export type EntryWithJob = TimeEntry & { job: JobRef; project: ProjectRef | null; tags: TagLite[] };

export type ListEntriesOptions = {
  jobId?: number;
  jobNumber?: string;
  projectId?: number;
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
    .select({ entry: timeEntries, job: jobRefColumns, project: { id: projects.id, title: projects.title } })
    .from(timeEntries)
    .innerJoin(jobs, eq(timeEntries.jobId, jobs.id))
    .leftJoin(projects, eq(timeEntries.projectId, projects.id));
}

function shape(row: { entry: TimeEntry; job: JobRef; project: ProjectRef | null }): EntryWithJob {
  return { ...row.entry, job: row.job, project: row.project, tags: [] };
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
  if (opts.projectId !== undefined) conditions.push(eq(timeEntries.projectId, opts.projectId));
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

/**
 * The entries as they are BOOKED — what the reports and the exports (Chrono, Punch, the CSV) are made of:
 * the tasks of grouped parallel work whose group books the hours (combined, collected) book 0 and are
 * left out — and a collecting entry that books nothing (its tasks book instead); every task of a divided or
 * one-after-the-other group is there with what it books.
 * (The overview shows all entries — listEntries — with what each really worked.)
 */
export function listBookedEntries(opts: ListEntriesOptions = {}): EntryWithJob[] {
  return listEntries(opts).filter((e) => !((e.spanId || e.isGroup) && e.hours <= 0));
}

export function getEntry(id: number): EntryWithJob | undefined {
  const row = selectEntries().where(eq(timeEntries.id, id)).get();
  return row ? attachTags([shape(row)])[0] : undefined;
}

export function requireEntry(id: number): EntryWithJob {
  const entry = getEntry(id);
  if (!entry) throw new NotFoundError(t("Time entry #{id} not found.", { id }));
  return entry;
}

/**
 * Where an entry is booked: on a project (its job, or the "No job yet" placeholder
 * while it has none) or directly on a job.
 */
function resolveBooking(
  jobNumber: string | undefined,
  projectId: number | undefined,
): { job: Job; projectId: number | null; projectTitle: string } {
  if (projectId !== undefined) {
    const project = requireProject(projectId);
    return { job: projectBookingJob(project), projectId: project.id, projectTitle: project.title };
  }
  if (!jobNumber?.trim()) throw new ValidationError(t("Pick a job or a project to book on."));
  const job = requireJobByNumber(jobNumber);
  if (isNoJobPlaceholder(job)) {
    throw new ValidationError(t("\"{job}\" is only for project entries — pick a job or a project.", { job: job.name }));
  }
  return { job, projectId: null, projectTitle: "" };
}

/** An entry in the shape report rules match on (Jira titles and type names only matter for templates). */
function ruleEntryOf(e: {
  type: EntryType;
  description: string;
  ticket: string | null;
  tags: string[];
  job: { number: string; name: string };
  projectTitle: string;
}): RuleEntry {
  return {
    type: e.type,
    typeLabel: e.type,
    ticket: e.ticket,
    ticketName: "",
    description: e.description,
    tags: e.tags.map((name) => ({ name })),
    jobNumber: e.job.number,
    jobName: e.job.name,
    project: e.projectTitle,
  };
}

export function createEntry(
  raw: TimeEntryInput,
  source: TimeEntry["source"],
  /** defaultTags: false when the caller already chose the tags (the web form pre-fills the defaults). */
  opts: { externalId?: string; defaultTags?: boolean } = {},
): EntryWithJob {
  const parsed = timeEntryInputSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(formatZodError(parsed.error));
  const input = parsed.data;
  const { job, projectId, projectTitle } = resolveBooking(input.jobNumber, input.projectId);

  // Move any #tags in the description into the tag list, cleaning the text.
  const { text: description, tags: hashTags } = extractHashtags(input.description);
  const tagNames = dedupeTags([
    ...(input.tags ?? []),
    ...hashTags,
    // The default tags of the job, project and ticket.
    ...(opts.defaultTags === false ? [] : defaultTagsFor({ jobId: job.id, projectId, ticket: input.ticket })),
  ]);
  // No explicit type (agents, imports): the type rules decide, else the source/ticket default.
  if (input.type) assertEntryType(input.type);
  const inferred = input.type ? undefined : inferType(getTypeRules(), { jobNumber: job.number, description });
  const type: EntryType = input.type ?? (inferred && isEntryType(inferred) ? inferred : undefined) ?? defaultType(input.ticket, source);
  // Plus the tags of the report rule the entry falls under (e.g. #mob on Mob Programming meetings).
  const allTags = dedupeTags([
    ...tagNames,
    ...ruleTags(getStoredReportRules(), ruleEntryOf({ type, description, ticket: input.ticket || null, tags: tagNames, job, projectTitle })),
  ]);

  const inserted = getDb()
    .insert(timeEntries)
    .values({
      jobId: job.id,
      projectId,
      date: input.date,
      hours: round2(input.hours),
      description,
      type,
      ticket: input.ticket || null,
      reportedBy: input.reportedBy || (source === "mcp" ? "agent" : "web"),
      source,
      externalId: opts.externalId ?? null,
      isGroup: !!input.isGroup,
      groupKind: input.isGroup ? "collect" : null,
      start: normalizeStart(input.start),
    })
    .returning()
    .get();
  if (allTags.length) {
    setEntryTags(inserted.id, getOrCreateTags(allTags).map((t) => t.id));
  }
  // A group entry (a mob day) collects the day's parallel work: its span.
  if (inserted.isGroup) ensureHeadSpan(inserted.id, "collect");
  return requireEntry(inserted.id);
}

/**
 * Give existing entries the tags of the report rule each falls under (see createEntry) —
 * only adds missing tags, never removes any. Returns how many entries got new tags.
 */
export function applyReportRuleTagsToEntries(): number {
  const rules = getStoredReportRules();
  if (!rules.some((r) => r.tags?.length)) return 0;
  let changed = 0;
  for (const e of listEntries()) {
    const names = e.tags.map((t) => t.name);
    const add = ruleTags(rules, ruleEntryOf({ ...e, tags: names, projectTitle: e.project?.title ?? "" }));
    const next = dedupeTags([...names, ...add]);
    if (next.length === names.length) continue;
    setEntryTags(e.id, getOrCreateTags(next).map((t) => t.id));
    changed++;
  }
  return changed;
}

/**
 * Re-book imported meetings (source "calendar") whose description matches a meeting→job
 * rule onto that rule's job. Meetings no rule matches keep their job (it may have been
 * picked by hand on import). Returns the moves.
 */
export function reapplyMeetingJobRules(
  rules: MeetingJobRule[],
): { id: number; date: string; description: string; from: string; to: string }[] {
  if (rules.length === 0) return [];
  const db = getDb();
  const rows = db
    .select({ id: timeEntries.id, date: timeEntries.date, description: timeEntries.description, jobNumber: jobs.number })
    .from(timeEntries)
    .innerJoin(jobs, eq(jobs.id, timeEntries.jobId))
    .where(and(eq(timeEntries.source, "calendar"), isNull(timeEntries.projectId)))
    .all();
  const moves: { id: number; date: string; description: string; from: string; to: string }[] = [];
  for (const r of rows) {
    const target = jobForMeeting(r.description, rules);
    if (!target || target === r.jobNumber) continue;
    const job = requireJobByNumber(target);
    db.update(timeEntries).set({ jobId: job.id, updatedAt: sql`(CURRENT_TIMESTAMP)` }).where(eq(timeEntries.id, r.id)).run();
    moves.push({ id: r.id, date: r.date, description: r.description, from: r.jobNumber, to: target });
  }
  return moves;
}

/** Re-type existing entries by the saved type rules; returns how many changed. */
export function applyTypeRulesToEntries(): number {
  const rules = getTypeRules();
  if (rules.length === 0) return 0;
  const db = getDb();
  const rows = db
    .select({ id: timeEntries.id, type: timeEntries.type, description: timeEntries.description, jobNumber: jobs.number })
    .from(timeEntries)
    .innerJoin(jobs, eq(jobs.id, timeEntries.jobId))
    .all();
  let changed = 0;
  for (const r of rows) {
    const type = inferType(rules, r);
    if (!type || type === r.type || !isEntryType(type)) continue;
    db.update(timeEntries).set({ type, updatedAt: sql`(CURRENT_TIMESTAMP)` }).where(eq(timeEntries.id, r.id)).run();
    changed++;
  }
  return changed;
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
  if (patch.type !== undefined) assertEntryType(patch.type);

  // Booking: a project books on its job; null detaches (keeping the given or current job);
  // moving to another job directly takes the entry out of its project.
  let booking: { jobId: number; projectId: number | null } | undefined;
  if (patch.projectId != null) {
    const b = resolveBooking(undefined, patch.projectId);
    booking = { jobId: b.job.id, projectId: b.projectId };
  } else if (patch.projectId === null) {
    const keep = isNoJobPlaceholder(existing.job) ? undefined : existing.job.number;
    booking = { jobId: resolveBooking(patch.jobNumber ?? keep, undefined).job.id, projectId: null };
  } else if (patch.jobNumber !== undefined && requireJobByNumber(patch.jobNumber).id !== existing.jobId) {
    booking = { jobId: resolveBooking(patch.jobNumber, undefined).job.id, projectId: null };
  }

  // Extract #tags from a new description, if one was given.
  let description = patch.description;
  let hashTags: string[] = [];
  if (patch.description !== undefined) {
    const parsedDesc = extractHashtags(patch.description);
    description = parsedDesc.text;
    hashTags = parsedDesc.tags;
  }

  // Parallel work stays whole: a task of a span edits what it WORKED (what it books follows the span's way of booking);
  // a combined entry made by Zeff whose hours you set becomes yours (a collecting entry); a task moved to another day leaves its span.
  if (existing.spanId && patch.date !== undefined && patch.date !== existing.date) {
    unlinkMember(id);
  }
  const member = existing.spanId && (patch.date === undefined || patch.date === existing.date);
  const headSpan = spanOfHead(id);
  const userHead = !!headSpan && !headSpan.headAuto;
  if (headSpan?.headAuto && patch.hours !== undefined && round2(patch.hours) !== existing.hours) setSpanMode(headSpan.id, "collect");
  getDb()
    .update(timeEntries)
    .set({
      ...(booking && { jobId: booking.jobId, projectId: booking.projectId }),
      ...(patch.date !== undefined && { date: patch.date }),
      ...(patch.hours !== undefined && (member ? { workedHours: round2(patch.hours) } : userHead ? { workedHours: round2(patch.hours), hours: round2(patch.hours) } : { hours: round2(patch.hours) })),
      ...(description !== undefined && { description }),
      ...(patch.type !== undefined && { type: patch.type }),
      ...(patch.ticket !== undefined && { ticket: patch.ticket || null }),
      ...(patch.reportedBy !== undefined && { reportedBy: patch.reportedBy }),
      ...(patch.isGroup !== undefined && { isGroup: patch.isGroup }),
      ...(patch.start !== undefined && { start: normalizeStart(patch.start) }),
      updatedAt: sql`(CURRENT_TIMESTAMP)`,
    })
    .where(eq(timeEntries.id, id))
    .run();

  if (patch.isGroup === true && !existing.isGroup) ensureHeadSpan(id, "collect");
  if (patch.isGroup === false && existing.isGroup) releaseHead(id);
  if (member && getSpan(existing.spanId)) recomputeSpan(existing.spanId!);
  // A collecting entry of yours: its total is what it was set to — what it books follows the group's way of booking.
  if (userHead && patch.hours !== undefined) recomputeSpan(headSpan.id);
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
  // A task of a span: the span is recalculated; a head: the tasks book what they worked again (they are never deleted with it).
  const after = beforeEntryDeleted(entry);
  getDb().delete(timeEntries).where(eq(timeEntries.id, id)).run();
  after();
  return entry;
}

/** The entries booked on these days — what calendar meetings are matched against (see findBookedMeetings). */
export function listBookedOnDates(dates: string[]): BookedEntry[] {
  if (dates.length === 0) return [];
  return getDb()
    .select({
      id: timeEntries.id,
      date: timeEntries.date,
      description: timeEntries.description,
      type: timeEntries.type,
      externalId: timeEntries.externalId,
    })
    .from(timeEntries)
    .where(inArray(timeEntries.date, [...new Set(dates)]))
    .all();
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

/** The job of each ticket's latest booking, by lowercase ticket (one scan, instead of one per ticket). */
export function jobNumbersByTicket(): Map<string, string> {
  const rows = getDb()
    .select({ ticket: timeEntries.ticket, number: jobs.number })
    .from(timeEntries)
    .innerJoin(jobs, eq(jobs.id, timeEntries.jobId))
    .where(sql`${timeEntries.ticket} is not null and trim(${timeEntries.ticket}) <> ''`)
    .orderBy(desc(timeEntries.date), desc(timeEntries.id))
    .all();
  const out = new Map<string, string>();
  for (const r of rows) {
    const key = r.ticket!.trim().toLowerCase();
    if (!out.has(key)) out.set(key, r.number);
  }
  return out;
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
  /** Set on a project's row: the project's entries on this job, shown under its title. */
  project: ProjectRef | null;
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
  // One row per job, plus one per project (listed under the project's title).
  const byRow = new Map<string, WeeklyReportRow>();
  const dayTotals = Array(7).fill(0) as number[];
  const reporters = new Set<string>();

  for (const e of entries) {
    const idx = dayIndex.get(e.date);
    if (idx === undefined) continue;
    const key = `${e.jobId}:${e.projectId ?? ""}`;
    let row = byRow.get(key);
    if (!row) {
      row = { job: e.job, project: e.project, hoursByDay: Array(7).fill(0) as number[], total: 0 };
      byRow.set(key, row);
    }
    row.hoursByDay[idx] = round2(row.hoursByDay[idx] + e.hours);
    row.total = round2(row.total + e.hours);
    dayTotals[idx] = round2(dayTotals[idx] + e.hours);
    reporters.add(e.reportedBy);
  }

  // By job number, each job's own row before its projects; projects without a job last.
  const placeholderLast = (r: WeeklyReportRow) => (isNoJobPlaceholder(r.job) ? 1 : 0);
  const rows = [...byRow.values()].sort(
    (a, b) =>
      placeholderLast(a) - placeholderLast(b) ||
      a.job.number.localeCompare(b.job.number, undefined, { numeric: true }) ||
      (a.project ? 1 : 0) - (b.project ? 1 : 0) ||
      (a.project?.title ?? "").localeCompare(b.project?.title ?? ""),
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

/** Booked hours per day between two dates (inclusive), optionally one reporter's: YYYY-MM-DD → hours. */
export function getDayTotals(fromIso: string, toIso: string, reportedBy?: string): Map<string, number> {
  const conditions = [gte(timeEntries.date, fromIso), lte(timeEntries.date, toIso)];
  if (reportedBy) conditions.push(sql`lower(${timeEntries.reportedBy}) = lower(${reportedBy})`);
  const rows = getDb()
    .select({ date: timeEntries.date, hours: sql<number>`sum(${timeEntries.hours})` })
    .from(timeEntries)
    .where(and(...conditions))
    .groupBy(timeEntries.date)
    .all();
  return new Map(rows.map((r) => [r.date, round2(Number(r.hours))]));
}

/** Distinct meeting titles (the descriptions of meeting entries), most recently booked first. */
export function listMeetingTitles(limit = 100): string[] {
  return getDb()
    .select({ title: timeEntries.description })
    .from(timeEntries)
    .where(eq(timeEntries.type, "meeting"))
    .groupBy(timeEntries.description)
    .orderBy(desc(sql`max(${timeEntries.date})`))
    .limit(limit)
    .all()
    .map((r) => r.title)
    .filter(Boolean);
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

