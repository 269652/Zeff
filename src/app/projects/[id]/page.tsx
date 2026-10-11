import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { isInstalled } from "@/plugins/state";
import type { Metadata } from "next";
import { t } from "@/lib/i18n/server";
import { rich } from "@/lib/i18n/rich";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { bookProjectDaysAction, updateProjectAction } from "@/app/actions";
import { DeleteProjectButton } from "@/components/DeleteProjectButton";
import { EntriesTable } from "@/components/EntriesTable";
import { ProjectBookDaysForm } from "@/components/ProjectBookDaysForm";
import { ProjectForm } from "@/components/ProjectForm";
import { listEntries } from "@/lib/entries";
import { formatHours } from "@/lib/format";
import { listJobs } from "@/lib/jobs";
import { getDefaultTags } from "@/lib/default-tags";
import { listEntryTypes } from "@/lib/entry-types";
import { getProject } from "@/lib/projects";
import { listTags } from "@/lib/tags";
import { todayIso } from "@/lib/week";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Project") };
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  if (!isInstalled("zeiterfassung")) return <PluginNotInstalled id="zeiterfassung" />;
  const { id } = await params;
  const projectId = Number(id);
  if (!Number.isInteger(projectId)) notFound();
  const project = getProject(projectId);
  if (!project) notFound();

  const entries = listEntries({ projectId, limit: 500 });
  // Offer active jobs, plus the project's own job even if it has been deactivated.
  const jobs = listJobs().map((j) => ({ number: j.number, name: j.name }));
  if (project.job && !jobs.some((j) => j.number === project.job!.number)) {
    jobs.unshift({ number: project.job.number, name: project.job.name });
  }

  return (
    <div className="page">
      <div className="page-aside">
        <div>
          <Link href="/projects" className="text-sm text-zinc-500 hover:underline">{t("← All projects")}</Link>
          <h1 className="text-lg font-semibold">
            {project.title}
            {!project.active && <span className="badge badge-web ml-2 align-middle">{t("inactive")}</span>}
          </h1>
          <p className="text-sm text-zinc-500">
            {t("{hours}h booked in {n} entries", { hours: formatHours(project.totalHours), n: project.entryCount })} ·{" "}
            {project.job ? (
              rich(t("on <link>{job}</link>", { job: `${project.job.number} ${project.job.name}` }), {
                link: () => (
                  <Link href={`/jobs/${project.job!.id}`} className="hover:underline">
                    <span className="font-mono">{project.job!.number}</span> {project.job!.name}
                  </Link>
                ),
              })
            ) : (
              <span className="badge badge-nojob">{t("No job yet")}</span>
            )}
          </p>
          {!project.job && project.entryCount > 0 && (
            <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">
              {t("The Roar export skips these entries until you pick the project's job below.")}
            </p>
          )}
        </div>
        <DeleteProjectButton id={project.id} title={project.title} entryCount={project.entryCount} />
      </div>

      <section className="card p-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-500 uppercase">{t("Edit project")}</h2>
        <ProjectForm
          action={updateProjectAction.bind(null, project.id)}
          jobs={jobs}
          mode="edit"
          submitLabel={t("Save")}
          entryCount={project.entryCount}
          allTags={listTags().map((tag) => tag.name)}
          defaults={{
            tags: getDefaultTags({ project: project.id }),
            title: project.title,
            description: project.description ?? "",
            customer: project.customer ?? "",
            jobNumber: project.job?.number ?? "",
            startDate: project.startDate ?? "",
            endDate: project.endDate ?? "",
            active: project.active,
          }}
        />
      </section>

      <section className="card p-4">
        <h2 className="mb-1 text-sm font-semibold text-zinc-500 uppercase">{t("Book days")}</h2>
        <p className="mb-3 text-xs text-zinc-500">
          {t("One entry per working day — e.g. all days of a training. Single entries can also be booked on the project from the week page (“Book on”).")}
        </p>
        <ProjectBookDaysForm
          action={bookProjectDaysAction.bind(null, project.id)}
          defaultDescription={project.title}
          defaultFrom={todayIso()}
          types={listEntryTypes()}
        />
      </section>

      <section className="card p-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-500 uppercase">{t("Time entries")}</h2>
        <EntriesTable entries={entries} showJob={false} showProject={false} />
      </section>
    </div>
  );
}
