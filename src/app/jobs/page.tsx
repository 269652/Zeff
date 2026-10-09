import { format } from "date-fns";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { createJobAction, toggleJobActiveAction } from "@/app/actions";
import { JobForm } from "@/components/JobForm";
import { ChronoJobsSyncButton } from "@/components/ChronoJobsSyncButton";
import { StatusIcon } from "@/components/StatusIcon";
import { SubmitButton } from "@/components/SubmitButton";
import { formatHours } from "@/lib/format";
import { listDefaultTagMaps } from "@/lib/default-tags";
import { listJobs } from "@/lib/jobs";
import { listTags } from "@/lib/tags";

export const metadata: Metadata = { title: "Jobs" };

export default async function JobsPage() {
  await connection();
  const jobs = listJobs({ includeInactive: true });
  const allTags = listTags().map((t) => t.name);
  const defaultTags = listDefaultTagMaps().jobs;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Jobs</h1>
        <p className="text-sm text-zinc-500">
          Job numbers that time can be booked on — from the web UI or via the MCP{" "}
          <code className="code">report_time</code> tool.
        </p>
      </div>

      <section className="card p-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-500 uppercase">New job</h2>
        <JobForm action={createJobAction} allTags={allTags} />
      </section>

      <section className="card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">All jobs ({jobs.length})</h2>
          <ChronoJobsSyncButton count={jobs.length} />
        </div>
        {jobs.length === 0 ? (
          <p className="py-4 text-center text-sm text-zinc-500">No jobs yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Name</th>
                  <th>Customer</th>
                  <th className="num">Hours</th>
                  <th className="num">Entries</th>
                  <th className="text-center">Chrono</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id} className={j.active ? "" : "text-zinc-400"}>
                    <td className="font-mono">
                      <Link href={`/jobs/${j.id}`} className="hover:underline">{j.number}</Link>
                    </td>
                    <td>
                      <Link href={`/jobs/${j.id}`} className="font-medium hover:underline">{j.name}</Link>
                      {j.description && <div className="text-xs text-zinc-500">{j.description}</div>}
                      {(defaultTags[j.number] ?? []).length > 0 && (
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {(defaultTags[j.number] ?? []).map((t) => (
                            <span key={t} className="badge badge-tag">#{t}</span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td>{j.customer ?? ""}</td>
                    <td className="num">{formatHours(j.totalHours)}</td>
                    <td className="num">{j.entryCount}</td>
                    <td className="text-center">
                      <ChronoMark job={j} />
                    </td>
                    <td>
                      <span className={`badge ${j.active ? "badge-mcp" : "badge-web"}`}>
                        {j.active ? "active" : "inactive"}
                      </span>
                    </td>
                    <td>
                      <div className="flex justify-end gap-1">
                        <Link href={`/jobs/${j.id}`} className="btn btn-sm">Edit</Link>
                        <form action={toggleJobActiveAction}>
                          <input type="hidden" name="id" value={j.id} />
                          <input type="hidden" name="active" value={j.active ? "false" : "true"} />
                          <SubmitButton className="btn btn-sm" pendingText="…">
                            {j.active ? "Deactivate" : "Activate"}
                          </SubmitButton>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/** The Chrono column: a checkmark when the last "Sync with Chrono" found the job, a cross when it didn't. */
function ChronoMark({ job }: { job: { chronoFound: boolean | null; chronoName: string | null; chronoClient: string | null; chronoCheckedAt: string | null } }) {
  const checked = job.chronoCheckedAt ? ` · checked ${format(new Date(job.chronoCheckedAt), "d MMM yyyy, HH:mm")}` : "";
  if (job.chronoFound === null) {
    return <span className="text-zinc-300 dark:text-zinc-600" title="Not looked up yet — Sync with Chrono">–</span>;
  }
  return job.chronoFound ? (
    <span className="inline-flex" title={`In Chrono: ${job.chronoName ?? "?"}${job.chronoClient ? ` (${job.chronoClient})` : ""}${checked}`}>
      <StatusIcon kind="check" className="text-emerald-600 dark:text-emerald-400" />
    </span>
  ) : (
    <span className="inline-flex" title={`Not found in Chrono's job search${checked}`}>
      <StatusIcon kind="cross" className="text-red-600 dark:text-red-400" />
    </span>
  );
}
