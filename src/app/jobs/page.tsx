import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { createJobAction, toggleJobActiveAction } from "@/app/actions";
import { JobForm } from "@/components/JobForm";
import { SubmitButton } from "@/components/SubmitButton";
import { formatHours } from "@/lib/format";
import { listJobs } from "@/lib/jobs";

export const metadata: Metadata = { title: "Jobs" };

export default async function JobsPage() {
  await connection();
  const jobs = listJobs({ includeInactive: true });

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
        <JobForm action={createJobAction} />
      </section>

      <section className="card p-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-500 uppercase">
          All jobs ({jobs.length})
        </h2>
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
                    </td>
                    <td>{j.customer ?? ""}</td>
                    <td className="num">{formatHours(j.totalHours)}</td>
                    <td className="num">{j.entryCount}</td>
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
