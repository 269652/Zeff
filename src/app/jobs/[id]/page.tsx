import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { isInstalled } from "@/plugins/state";
import type { Metadata } from "next";
import { t } from "@/lib/i18n/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { updateJobAction } from "@/app/actions";
import { DeleteJobButton } from "@/components/DeleteJobButton";
import { EntriesTable } from "@/components/EntriesTable";
import { JobForm } from "@/components/JobForm";
import { getJobHours, listEntries } from "@/lib/entries";
import { formatHours } from "@/lib/format";
import { getDefaultTags } from "@/lib/default-tags";
import { getJob } from "@/lib/jobs";
import { listTags } from "@/lib/tags";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Job") };
}

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  if (!isInstalled("zeiterfassung")) return <PluginNotInstalled id="zeiterfassung" />;
  const { id } = await params;
  const jobId = Number(id);
  if (!Number.isInteger(jobId)) notFound();
  const job = getJob(jobId);
  if (!job) notFound();

  const entries = listEntries({ jobId, limit: 200 });
  const total = getJobHours(jobId);

  return (
    <div className="page">
      <div className="page-aside">
        <div>
          <Link href="/jobs" className="text-sm text-zinc-500 hover:underline">{t("← All jobs")}</Link>
          <h1 className="text-lg font-semibold">
            <span className="font-mono">{job.number}</span> {job.name}
            {!job.active && <span className="badge badge-web ml-2 align-middle">{t("inactive")}</span>}
          </h1>
          <p className="text-sm text-zinc-500">
            {t("{hours}h booked in {n} entries", { hours: formatHours(total), n: entries.length })}
          </p>
        </div>
        <DeleteJobButton id={job.id} number={job.number} />
      </div>

      <section className="card p-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-500 uppercase">{t("Edit job")}</h2>
        <JobForm
          action={updateJobAction.bind(null, job.id)}
          mode="edit"
          submitLabel={t("Save")}
          allTags={listTags().map((tag) => tag.name)}
          defaults={{
            tags: getDefaultTags({ job: job.id }),
            number: job.number,
            name: job.name,
            customer: job.customer ?? "",
            description: job.description ?? "",
            active: job.active,
          }}
        />
      </section>

      <section className="card p-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-500 uppercase">{t("Time entries")}</h2>
        <EntriesTable entries={entries} showJob={false} />
      </section>
    </div>
  );
}
