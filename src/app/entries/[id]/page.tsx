import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { deleteEntryAction, updateEntryAction } from "@/app/actions";
import { EntryForm } from "@/components/EntryForm";
import { SubmitButton } from "@/components/SubmitButton";
import { getEntry, listWeekTickets } from "@/lib/entries";
import { formatHours } from "@/lib/format";
import { listJobs } from "@/lib/jobs";
import { listTags } from "@/lib/tags";
import { weekFromDate } from "@/lib/week";

export const metadata: Metadata = { title: "Edit entry" };

export default async function EntryPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const entryId = Number(id);
  if (!Number.isInteger(entryId)) notFound();
  const entry = getEntry(entryId);
  if (!entry) notFound();

  // Offer active jobs, plus the entry's own job even if it has been deactivated.
  const jobs = listJobs();
  if (!jobs.some((j) => j.id === entry.jobId)) {
    jobs.unshift({ ...entry.job, description: null, createdAt: "", entryCount: 0, totalHours: 0 });
  }
  const week = weekFromDate(new Date(entry.date + "T00:00:00"));
  const allTags = listTags().map((t) => t.name);
  const ticketSuggestions = listWeekTickets(week);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href={`/?week=${week.key}`} className="text-sm text-zinc-500 hover:underline">
            ← Week {week.week}
          </Link>
          <h1 className="text-lg font-semibold">
            Entry #{entry.id} · {formatHours(entry.hours)}h on{" "}
            <span className="font-mono">{entry.job.number}</span>
          </h1>
          <p className="text-sm text-zinc-500">
            Reported by {entry.reportedBy} via {entry.source} · created {entry.createdAt} UTC
          </p>
        </div>
        <form action={deleteEntryAction}>
          <input type="hidden" name="id" value={entry.id} />
          <input type="hidden" name="redirectTo" value="/?week={date}" />
          <SubmitButton
            className="btn btn-danger"
            pendingText="Deleting…"
            confirm={`Delete this ${formatHours(entry.hours)}h entry?`}
          >
            Delete entry
          </SubmitButton>
        </form>
      </div>

      <section className="card p-4">
        <EntryForm
          jobs={jobs}
          action={updateEntryAction.bind(null, entry.id)}
          submitLabel="Save"
          resetOnSuccess={false}
          allTags={allTags}
          ticketSuggestions={ticketSuggestions}
          defaults={{
            jobNumber: entry.job.number,
            date: entry.date,
            hours: entry.hours,
            description: entry.description,
            ticket: entry.ticket ?? "",
            reportedBy: entry.reportedBy,
            type: entry.type,
            tags: entry.tags.map((t) => t.name),
          }}
        />
      </section>
    </div>
  );
}
