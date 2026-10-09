import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getOrCreateTags } from "./tags";
import { dedupeTags, type DefaultTagMaps } from "./tags-shared";

const { jobs, jobTags, projectTags, tags, ticketTags } = schema;

/**
 * Default tags of jobs, projects and tickets: added to every entry booked on them (the
 * entry form pre-fills them; agents, imports and "Book days" get them automatically).
 */
export type DefaultTagTarget = { job: number } | { project: number } | { ticket: string };

const ticketKey = (t: string) => t.trim().toUpperCase();

export function getDefaultTags(target: DefaultTagTarget): string[] {
  const db = getDb();
  if ("job" in target) {
    return db.select({ name: tags.name }).from(jobTags).innerJoin(tags, eq(tags.id, jobTags.tagId))
      .where(eq(jobTags.jobId, target.job)).orderBy(asc(tags.name)).all().map((r) => r.name);
  }
  if ("project" in target) {
    return db.select({ name: tags.name }).from(projectTags).innerJoin(tags, eq(tags.id, projectTags.tagId))
      .where(eq(projectTags.projectId, target.project)).orderBy(asc(tags.name)).all().map((r) => r.name);
  }
  return db.select({ name: tags.name }).from(ticketTags).innerJoin(tags, eq(tags.id, ticketTags.tagId))
    .where(eq(ticketTags.ticket, ticketKey(target.ticket))).orderBy(asc(tags.name)).all().map((r) => r.name);
}

/** Replace the default tags of a job, project or ticket (missing tags are created). */
export function setDefaultTags(target: DefaultTagTarget, names: string[]): string[] {
  const tagRows = getOrCreateTags(names);
  getDb().transaction((tx) => {
    if ("job" in target) {
      tx.delete(jobTags).where(eq(jobTags.jobId, target.job)).run();
      if (tagRows.length) tx.insert(jobTags).values(tagRows.map((t) => ({ jobId: target.job, tagId: t.id }))).run();
    } else if ("project" in target) {
      tx.delete(projectTags).where(eq(projectTags.projectId, target.project)).run();
      if (tagRows.length) tx.insert(projectTags).values(tagRows.map((t) => ({ projectId: target.project, tagId: t.id }))).run();
    } else {
      const ticket = ticketKey(target.ticket);
      tx.delete(ticketTags).where(eq(ticketTags.ticket, ticket)).run();
      if (tagRows.length) tx.insert(ticketTags).values(tagRows.map((t) => ({ ticket, tagId: t.id }))).run();
    }
  });
  return tagRows.map((t) => t.name);
}

/** Every default tag, for the entry form: by job number, project id and ticket key. */
export function listDefaultTagMaps(): DefaultTagMaps {
  const db = getDb();
  const maps: DefaultTagMaps = { jobs: {}, projects: {}, tickets: {} };
  const jobRows = db.select({ job: jobs.number, name: tags.name }).from(jobTags)
    .innerJoin(jobs, eq(jobs.id, jobTags.jobId)).innerJoin(tags, eq(tags.id, jobTags.tagId)).orderBy(asc(tags.name)).all();
  for (const r of jobRows) (maps.jobs[r.job] ??= []).push(r.name);
  const projectRows = db.select({ project: projectTags.projectId, name: tags.name }).from(projectTags)
    .innerJoin(tags, eq(tags.id, projectTags.tagId)).orderBy(asc(tags.name)).all();
  for (const r of projectRows) (maps.projects[r.project] ??= []).push(r.name);
  const ticketRows = db.select({ ticket: ticketTags.ticket, name: tags.name }).from(ticketTags)
    .innerJoin(tags, eq(tags.id, ticketTags.tagId)).orderBy(asc(tags.name)).all();
  for (const r of ticketRows) (maps.tickets[r.ticket] ??= []).push(r.name);
  return maps;
}

/** The default tags for a booking: its job's, its project's and its ticket's. */
export function defaultTagsFor(b: { jobId: number; projectId?: number | null; ticket?: string | null }): string[] {
  return dedupeTags([
    ...getDefaultTags({ job: b.jobId }),
    ...(b.projectId ? getDefaultTags({ project: b.projectId }) : []),
    ...(b.ticket?.trim() ? getDefaultTags({ ticket: b.ticket }) : []),
  ]);
}
