/**
 * Server-free project helpers shared by the entry form and the server (never import a
 * DB-backed lib into a "use client" component).
 */

/**
 * The built-in placeholder job that entries of a project without a job are booked on.
 * It is hidden from job pickers and listings, and the Roar export skips it.
 */
export const NO_JOB_NUMBER = "NO-JOB";
export const NO_JOB_NAME = "No job yet";

/** What an entry is booked on: a project (its job is used) or a job directly. */
export type BookOn = { projectId: number } | { jobNumber: string };

/** The entry form's "Book on" select value: "p:<projectId>" or "j:<jobNumber>". */
export function bookOnValue(b: BookOn): string {
  return "projectId" in b ? `p:${b.projectId}` : `j:${b.jobNumber}`;
}

export function parseBookOn(value: string | null | undefined): BookOn | undefined {
  const v = value?.trim();
  if (!v) return undefined;
  if (v.startsWith("p:")) {
    const id = Number(v.slice(2));
    return Number.isInteger(id) && id > 0 ? { projectId: id } : undefined;
  }
  const number = (v.startsWith("j:") ? v.slice(2) : v).trim();
  return number ? { jobNumber: number } : undefined;
}

/** A project as a "Book on" option; its job (null = no job yet) is where the hours land. */
export type ProjectOption = { id: number; title: string; jobNumber: string | null; jobName: string | null };
