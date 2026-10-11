import { and, desc, eq, ne, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Job, Project } from "@/db/schema";
import { ConflictError, NotFoundError, ValidationError } from "./errors";
import { round2 } from "./format";
import { t } from "@/lib/i18n/server";
import { getJob, getJobByNumber, getNoJobPlaceholder, isNoJobPlaceholder, requireJobByNumber } from "./jobs";
import { NO_JOB_NUMBER, type ProjectOption } from "./projects-shared";
import { formatZodError, projectInputSchema, type ProjectInput } from "./validation";

const { jobs, projects, timeEntries } = schema;

export type ProjectJobRef = Pick<Job, "id" | "number" | "name">;

export type ProjectWithStats = Project & {
  /** The job the project books on; null = no job yet (entries sit on the placeholder). */
  job: ProjectJobRef | null;
  entryCount: number;
  totalHours: number;
  /** First and last day with an entry. */
  firstDate: string | null;
  lastDate: string | null;
};

function queryProjects(where?: SQL): ProjectWithStats[] {
  const rows = getDb()
    .select({
      project: projects,
      job: { id: jobs.id, number: jobs.number, name: jobs.name },
      entryCount: sql<number>`count(${timeEntries.id})`,
      totalHours: sql<number>`coalesce(sum(${timeEntries.hours}), 0)`,
      firstDate: sql<string | null>`min(${timeEntries.date})`,
      lastDate: sql<string | null>`max(${timeEntries.date})`,
    })
    .from(projects)
    .leftJoin(jobs, eq(jobs.id, projects.jobId))
    .leftJoin(timeEntries, eq(timeEntries.projectId, projects.id))
    .where(where)
    .groupBy(projects.id)
    .orderBy(desc(projects.active), sql`lower(${projects.title})`)
    .all();
  return rows.map((r) => ({
    ...r.project,
    job: r.job,
    entryCount: Number(r.entryCount),
    totalHours: round2(Number(r.totalHours)),
    firstDate: r.firstDate,
    lastDate: r.lastDate,
  }));
}

export function listProjects(opts: { includeInactive?: boolean } = {}): ProjectWithStats[] {
  return queryProjects(opts.includeInactive ? undefined : eq(projects.active, true));
}

export function getProject(id: number): ProjectWithStats | undefined {
  return queryProjects(eq(projects.id, id))[0];
}

export function requireProject(id: number): ProjectWithStats {
  const project = getProject(id);
  if (!project) throw new NotFoundError(t("Project #{id} not found.", { id }));
  return project;
}

/** Look up a project by its title, ignoring case. */
export function getProjectByTitle(title: string): Project | undefined {
  const want = title.trim();
  return getDb().select().from(projects).where(sql`lower(${projects.title}) = lower(${want})`).get();
}

export function requireProjectByTitle(title: string): Project {
  const project = getProjectByTitle(title);
  if (!project) {
    const known = listProjects().map((p) => `"${p.title}"`).join(", ");
    throw new NotFoundError(
      known
        ? t("Unknown project \"{title}\". Active projects: {known}.", { title: title.trim(), known })
        : t("Unknown project \"{title}\". No projects exist yet.", { title: title.trim() }),
    );
  }
  return project;
}

/** The job a project's entries are booked on: its job, or the "No job yet" placeholder. */
export function projectBookingJob(project: Pick<Project, "jobId">): Job {
  const job = project.jobId ? getJob(project.jobId) : undefined;
  return job ?? getNoJobPlaceholder();
}

/** A job number from the form → job id; empty (or the placeholder) = no job yet. */
function resolveJobId(jobNumber: string | undefined): number | null {
  if (!jobNumber?.trim()) return null;
  const job = requireJobByNumber(jobNumber);
  return isNoJobPlaceholder(job) ? null : job.id;
}

function checkRange(start: string | null | undefined, end: string | null | undefined) {
  if (start && end && end < start) throw new ValidationError(t("The end date is before the start date."));
}

export function createProject(raw: ProjectInput): ProjectWithStats {
  const parsed = projectInputSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(formatZodError(parsed.error));
  const input = parsed.data;
  if (getProjectByTitle(input.title)) {
    throw new ConflictError(t("A project named \"{title}\" already exists.", { title: input.title }));
  }
  checkRange(input.startDate, input.endDate);
  const row = getDb()
    .insert(projects)
    .values({
      title: input.title,
      description: input.description || null,
      customer: input.customer || null,
      jobId: resolveJobId(input.jobNumber),
      startDate: input.startDate || null,
      endDate: input.endDate || null,
      active: input.active ?? true,
    })
    .returning()
    .get();
  return requireProject(row.id);
}

/**
 * Update a project. A changed job moves all the project's entries onto it (or onto
 * the "No job yet" placeholder when the job is cleared); `moved` counts them.
 */
export function updateProject(
  id: number,
  raw: Partial<ProjectInput>,
): { project: ProjectWithStats; moved: number } {
  const parsed = projectInputSchema.partial().safeParse(raw);
  if (!parsed.success) throw new ValidationError(formatZodError(parsed.error));
  const patch = parsed.data;
  const existing = requireProject(id);
  if (patch.title !== undefined) {
    const clash = getProjectByTitle(patch.title);
    if (clash && clash.id !== id) throw new ConflictError(t("A project named \"{title}\" already exists.", { title: patch.title }));
  }
  checkRange(
    patch.startDate !== undefined ? patch.startDate : existing.startDate,
    patch.endDate !== undefined ? patch.endDate : existing.endDate,
  );
  const jobId = patch.jobNumber !== undefined ? resolveJobId(patch.jobNumber) : undefined;
  const target = jobId === undefined ? undefined : (jobId ?? getNoJobPlaceholder().id);

  let moved = 0;
  getDb().transaction((tx) => {
    tx.update(projects)
      .set({
        ...(patch.title !== undefined && { title: patch.title }),
        ...(patch.description !== undefined && { description: patch.description || null }),
        ...(patch.customer !== undefined && { customer: patch.customer || null }),
        ...(jobId !== undefined && { jobId }),
        ...(patch.startDate !== undefined && { startDate: patch.startDate || null }),
        ...(patch.endDate !== undefined && { endDate: patch.endDate || null }),
        ...(patch.active !== undefined && { active: patch.active }),
        updatedAt: sql`(CURRENT_TIMESTAMP)`,
      })
      .where(eq(projects.id, id))
      .run();
    // Entries follow the project's job.
    if (target !== undefined) {
      moved = tx
        .update(timeEntries)
        .set({ jobId: target, updatedAt: sql`(CURRENT_TIMESTAMP)` })
        .where(and(eq(timeEntries.projectId, id), ne(timeEntries.jobId, target)))
        .run().changes;
    }
  });
  return { project: requireProject(id), moved };
}

/**
 * Delete a project. Its entries stay booked on the project's job, just without the
 * project — unless it has no job yet: those entries would be stranded on the
 * placeholder, so set a job (or delete them) first.
 */
export function deleteProject(id: number): ProjectWithStats {
  const existing = requireProject(id);
  const db = getDb();
  const placeholder = getJobByNumber(NO_JOB_NUMBER);
  if (placeholder) {
    const row = db
      .select({ n: sql<number>`count(*)` })
      .from(timeEntries)
      .where(and(eq(timeEntries.projectId, id), eq(timeEntries.jobId, placeholder.id)))
      .get();
    const stranded = Number(row?.n ?? 0);
    if (stranded > 0) {
      throw new ConflictError(
        stranded === 1
          ? t("\"{title}\" has 1 entry without a job. Set the project's job first (or delete those entries), then delete the project.", { title: existing.title })
          : t("\"{title}\" has {n} entries without a job. Set the project's job first (or delete those entries), then delete the project.", { title: existing.title, n: stranded }),
      );
    }
  }
  db.transaction((tx) => {
    tx.update(timeEntries).set({ projectId: null }).where(eq(timeEntries.projectId, id)).run();
    tx.delete(projects).where(eq(projects.id, id)).run();
  });
  return existing;
}

/** Active projects as "Book on" options, plus `alsoId` (e.g. an edited entry's inactive project). */
export function listProjectOptions(alsoId?: number | null): ProjectOption[] {
  const list = listProjects();
  if (alsoId != null && !list.some((p) => p.id === alsoId)) {
    const extra = getProject(alsoId);
    if (extra) list.unshift(extra);
  }
  return list.map((p) => ({ id: p.id, title: p.title, jobNumber: p.job?.number ?? null, jobName: p.job?.name ?? null }));
}
