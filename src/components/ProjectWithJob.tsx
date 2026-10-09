import Link from "next/link";
import type { JobRef, ProjectRef } from "@/lib/entries";
import { NO_JOB_NUMBER } from "@/lib/projects-shared";

/**
 * A project's title with its job number in small below it (or a hint while it has no job yet).
 * `titleOnly`: just the title — the job in its tooltip; the no-job hint still shows.
 */
export function ProjectWithJob({ project, job, titleOnly = false }: { project: ProjectRef; job: JobRef; titleOnly?: boolean }) {
  const noJob = job.number === NO_JOB_NUMBER;
  return (
    <>
      <Link
        href={`/projects/${project.id}`}
        className={titleOnly ? "hover:underline" : "font-medium hover:underline"}
        title={titleOnly && !noJob ? `${job.number} — ${job.name}` : undefined}
      >
        {project.title}
      </Link>
      {noJob ? (
        <Link
          href={`/projects/${project.id}`}
          className="block text-xs text-amber-600 hover:underline dark:text-amber-400"
          title="Not exported to Roar until the project has a job"
        >
          no job yet
        </Link>
      ) : (
        !titleOnly && (
          <Link href={`/jobs/${job.id}`} className="block font-mono text-xs text-zinc-500 hover:underline" title={job.name}>
            {job.number}
          </Link>
        )
      )}
    </>
  );
}
