import { and, asc, desc, eq, like, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Job } from "@/db/schema";
import { ConflictError, NotFoundError, ValidationError } from "./errors";
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
};

export function listJobs(opts: ListJobsOptions = {}): JobWithStats[] {
  const db = getDb();
  const conditions = [];
  if (!opts.includeInactive) conditions.push(eq(jobs.active, true));
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
      `Unknown job number "${number.trim()}".` +
        (hint ? ` Did you mean: ${hint}?` : " No jobs exist yet — create one first."),
    );
  }
  return job;
}

/** Best-effort suggestions for an unknown job number (for error messages). */
export function suggestJobs(number: string, limit = 5): Job[] {
  const db = getDb();
  const needle = number.trim();
  const active = eq(jobs.active, true);
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

export function createJob(raw: JobInput): Job {
  const parsed = jobInputSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(formatZodError(parsed.error));
  const input = parsed.data;
  const db = getDb();
  if (getJobByNumber(input.number)) {
    throw new ConflictError(`A job with number "${input.number}" already exists.`);
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
  if (!existing) throw new NotFoundError(`Job #${id} not found.`);
  if (patch.number !== undefined) {
    const clash = getJobByNumber(patch.number);
    if (clash && clash.id !== id) {
      throw new ConflictError(`A job with number "${patch.number}" already exists.`);
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
  if (!existing) throw new NotFoundError(`Job #${id} not found.`);
  const used = db
    .select({ n: sql<number>`count(*)` })
    .from(timeEntries)
    .where(eq(timeEntries.jobId, id))
    .get();
  if (used && Number(used.n) > 0) {
    throw new ConflictError(
      `Job ${existing.number} has ${used.n} time entries and cannot be deleted. Deactivate it instead.`,
    );
  }
  db.delete(jobs).where(eq(jobs.id, id)).run();
}
