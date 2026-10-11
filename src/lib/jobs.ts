import { and, asc, desc, eq, like, ne, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Job } from "@/db/schema";
import { ConflictError, NotFoundError, ValidationError } from "./errors";
import { t } from "@/lib/i18n/server";
import { NO_JOB_NAME, NO_JOB_NUMBER } from "./projects-shared";
import { formatZodError, jobInputSchema, type JobInput } from "./validation";

const { jobs, timeEntries } = schema;

export type JobWithStats = Job & {
  entryCount: number;
  totalHours: number;
};

export type ListJobsOptions = {
  /** Case-insensitive match on number, name or customer. */
  query?: string;
  includeInactive?: boolean;
  /** Also list the built-in "No job yet" placeholder (hidden by default). */
  includePlaceholder?: boolean;
};

export function listJobs(opts: ListJobsOptions = {}): JobWithStats[] {
  const db = getDb();
  const conditions = [];
  if (!opts.includeInactive) conditions.push(eq(jobs.active, true));
  if (!opts.includePlaceholder) conditions.push(ne(jobs.number, NO_JOB_NUMBER));
  if (opts.query?.trim()) {
    const q = `%${opts.query.trim()}%`;
    conditions.push(
      or(like(jobs.number, q), like(jobs.name, q), like(jobs.customer, q)),
    );
  }

  const rows = db
    .select({
      job: jobs,
      entryCount: sql<number>`count(${timeEntries.id})`,
      totalHours: sql<number>`coalesce(sum(${timeEntries.hours}), 0)`,
    })
    .from(jobs)
    .leftJoin(timeEntries, eq(timeEntries.jobId, jobs.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .groupBy(jobs.id)
    .orderBy(desc(jobs.active), asc(jobs.number))
    .all();

  return rows.map((r) => ({
    ...r.job,
    entryCount: Number(r.entryCount),
    totalHours: Number(r.totalHours),
  }));
}

export function getJob(id: number): Job | undefined {
  return getDb().select().from(jobs).where(eq(jobs.id, id)).get();
}

/** Look up a job by its number; exact match first, then case-insensitive. */
export function getJobByNumber(number: string): Job | undefined {
  const db = getDb();
  const n = number.trim();
  return (
    db.select().from(jobs).where(eq(jobs.number, n)).get() ??
    db
      .select()
      .from(jobs)
      .where(sql`lower(${jobs.number}) = lower(${n})`)
      .get()
  );
}

export function requireJobByNumber(number: string): Job {
  const job = getJobByNumber(number);
  if (!job) {
    const hint = suggestJobs(number)
      .map((j) => `${j.number} (${j.name})`)
      .join(", ");
    throw new NotFoundError(
      hint
        ? t("Unknown job number \"{number}\". Did you mean: {hint}?", { number: number.trim(), hint })
        : t("Unknown job number \"{number}\". No jobs exist yet — create one first.", { number: number.trim() }),
    );
  }
  return job;
}

/** Best-effort suggestions for an unknown job number (for error messages). */
export function suggestJobs(number: string, limit = 5): Job[] {
  const db = getDb();
  const needle = number.trim();
  const active = and(eq(jobs.active, true), ne(jobs.number, NO_JOB_NUMBER));
  let rows: Job[] = [];
  if (needle) {
    const q = `%${needle}%`;
    rows = db
      .select()
      .from(jobs)
      .where(and(active, or(like(jobs.number, q), like(jobs.name, q))))
      .orderBy(asc(jobs.number))
      .limit(limit)
      .all();
  }
  if (rows.length === 0) {
    rows = db.select().from(jobs).where(active).orderBy(asc(jobs.number)).limit(limit).all();
  }
  return rows;
}

/**
 * The built-in placeholder job for entries of a project that has no job yet
 * (created on first use). Hidden from job listings; the Roar export skips it.
 */
export function getNoJobPlaceholder(): Job {
  const existing = getJobByNumber(NO_JOB_NUMBER);
  if (existing) return existing;
  return getDb()
    .insert(jobs)
    .values({
      number: NO_JOB_NUMBER,
      name: NO_JOB_NAME,
      description: "Built-in placeholder: entries of projects that have no job yet. Set the project's job to move them.",
    })
    .returning()
    .get();
}

export function isNoJobPlaceholder(job: Pick<Job, "number">): boolean {
  return job.number === NO_JOB_NUMBER;
}

function assertNotReserved(number: string) {
  if (number.trim().toLowerCase() === NO_JOB_NUMBER.toLowerCase()) {
    throw new ValidationError(t("\"{number}\" is reserved for entries of projects without a job.", { number: NO_JOB_NUMBER }));
  }
}

export function createJob(raw: JobInput): Job {
  const parsed = jobInputSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(formatZodError(parsed.error));
  const input = parsed.data;
  const db = getDb();
  assertNotReserved(input.number);
  if (getJobByNumber(input.number)) {
    throw new ConflictError(t("A job with number \"{number}\" already exists.", { number: input.number }));
  }
  return db
    .insert(jobs)
    .values({
      number: input.number,
      name: input.name,
      customer: input.customer || null,
      description: input.description || null,
      active: input.active ?? true,
    })
    .returning()
    .get();
}

export function updateJob(id: number, raw: Partial<JobInput>): Job {
  const parsed = jobInputSchema.partial().safeParse(raw);
  if (!parsed.success) throw new ValidationError(formatZodError(parsed.error));
  const patch = parsed.data;
  const db = getDb();
  const existing = getJob(id);
  if (!existing) throw new NotFoundError(t("Job #{id} not found.", { id }));
  if (patch.number !== undefined) {
    if (patch.number !== existing.number) assertNotReserved(patch.number);
    const clash = getJobByNumber(patch.number);
    if (clash && clash.id !== id) {
      throw new ConflictError(t("A job with number \"{number}\" already exists.", { number: patch.number }));
    }
  }
  return db
    .update(jobs)
    .set({
      ...(patch.number !== undefined && { number: patch.number }),
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.customer !== undefined && { customer: patch.customer || null }),
      ...(patch.description !== undefined && { description: patch.description || null }),
      ...(patch.active !== undefined && { active: patch.active }),
    })
    .where(eq(jobs.id, id))
    .returning()
    .get();
}

export function deleteJob(id: number): void {
  const db = getDb();
  const existing = getJob(id);
  if (!existing) throw new NotFoundError(t("Job #{id} not found.", { id }));
  const used = db
    .select({ n: sql<number>`count(*)` })
    .from(timeEntries)
    .where(eq(timeEntries.jobId, id))
    .get();
  if (used && Number(used.n) > 0) {
    throw new ConflictError(
      t("Job {number} has {n} time entries and cannot be deleted. Deactivate it instead.", { number: existing.number, n: used.n }),
    );
  }
  db.delete(jobs).where(eq(jobs.id, id)).run();
}

export type RoarLookup = { jobNumber: string; found: boolean; name?: string; client?: string; group?: string };

/** Store the result of looking jobs up in Roar ("Sync with Roar"); returns how many jobs were updated. */
export function recordRoarLookup(results: RoarLookup[]): number {
  const db = getDb();
  const checkedAt = new Date().toISOString();
  let updated = 0;
  for (const r of results) {
    const job = getJobByNumber(r.jobNumber);
    if (!job) continue;
    db.update(jobs)
      .set({
        roarFound: r.found,
        roarName: r.found ? (r.name ?? null) : null,
        roarClient: r.found ? [r.client, r.group].filter(Boolean).join(" · ") || null : null,
        roarCheckedAt: checkedAt,
      })
      .where(eq(jobs.id, job.id))
      .run();
    updated++;
  }
  return updated;
}
