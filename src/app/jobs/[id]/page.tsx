import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { updateJobAction } from "@/app/actions";
import { DeleteJobButton } from "@/components/DeleteJobButton";
import { EntriesTable } from "@/components/EntriesTable";
import { JobForm } from "@/components/JobForm";
import { getJobHours, listEntries } from "@/lib/entries";
import { formatHours } from "@/lib/format";
import { getJob } from "@/lib/jobs";

export const metadata: Metadata = { title: "Job" };

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const jobId = Number(id);
  if (!Number.isInteger(jobId)) notFound();
  const job = getJob(jobId);
  if (!job) notFound();

  const entries = listEntries({ jobId, limit: 200 });
  const total = getJobHours(jobId);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/jobs" className="text-sm text-zinc-500 hover:underline">← All jobs</Link>
          <h1 className="text-lg font-semibold">
            <span className="font-mono">{job.number}</span> {job.name}
            {!job.active && <span className="badge badge-web ml-2 align-middle">inactive</span>}
          </h1>
          <p className="text-sm text-zinc-500">
            {formatHours(total)}h booked in {entries.length} entries
          </p>
        </div>
        <DeleteJobButton id={job.id} number={job.number} />
      </div>

      <section className="card p-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-500 uppercase">Edit job</h2>
        <JobForm
          action={updateJobAction.bind(null, job.id)}
          mode="edit"
          submitLabel="Save"
          defaults={{
            number: job.number,
            name: job.name,
            customer: job.customer ?? "",
            description: job.description ?? "",
            active: job.active,
          }}
        />
      </section>

      <section className="card p-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-500 uppercase">Time entries</h2>
        <EntriesTable entries={entries} showJob={false} />
      </section>
    </div>
  );
}
