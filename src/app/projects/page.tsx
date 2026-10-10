import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { isInstalled } from "@/plugins/state";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { createProjectAction, toggleProjectActiveAction } from "@/app/actions";
import { ProjectForm } from "@/components/ProjectForm";
import { SubmitButton } from "@/components/SubmitButton";
import { formatHours } from "@/lib/format";
import { listJobs } from "@/lib/jobs";
import { listDefaultTagMaps } from "@/lib/default-tags";
import { listProjects } from "@/lib/projects";
import { listTags } from "@/lib/tags";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage() {
  await connection();
  if (!isInstalled("zeiterfassung")) return <PluginNotInstalled id="zeiterfassung" />;
  const projects = listProjects({ includeInactive: true });
  const jobs = listJobs().map((j) => ({ number: j.number, name: j.name }));
  const allTags = listTags().map((t) => t.name);
  const defaultTags = listDefaultTagMaps().projects;

  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">Projects</h1>
        <p className="text-sm text-zinc-500">
          Book time on a project instead of a job — e.g. a training. The hours land on the project&apos;s job, and
          setting or changing that job later moves all its entries along.
        </p>
      </div>

      <section className="card p-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-500 uppercase">New project</h2>
        <ProjectForm action={createProjectAction} jobs={jobs} allTags={allTags} />
      </section>

      <section className="card p-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-500 uppercase">All projects ({projects.length})</h2>
        {projects.length === 0 ? (
          <p className="py-4 text-center text-sm text-zinc-500">No projects yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Job</th>
                  <th>Customer</th>
                  <th>Booked</th>
                  <th className="num">Hours</th>
                  <th className="num">Entries</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id} className={p.active ? "" : "text-zinc-400"}>
                    <td>
                      <Link href={`/projects/${p.id}`} className="font-medium hover:underline">{p.title}</Link>
                      {p.description && <div className="text-xs text-zinc-500">{p.description}</div>}
                      {(defaultTags[p.id] ?? []).length > 0 && (
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {(defaultTags[p.id] ?? []).map((t) => (
                            <span key={t} className="badge badge-tag">#{t}</span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td>
                      {p.job ? (
                        <Link href={`/jobs/${p.job.id}`} className="hover:underline">
                          <span className="font-mono whitespace-nowrap">{p.job.number}</span> {p.job.name}
                        </Link>
                      ) : (
                        <span className="badge badge-nojob">No job yet</span>
                      )}
                    </td>
                    <td>{p.customer ?? ""}</td>
                    <td className="font-mono text-xs whitespace-nowrap text-zinc-500">
                      {p.firstDate ? (p.firstDate === p.lastDate ? p.firstDate : `${p.firstDate} – ${p.lastDate}`) : ""}
                    </td>
                    <td className="num">{formatHours(p.totalHours)}</td>
                    <td className="num">{p.entryCount}</td>
                    <td>
                      <span className={`badge ${p.active ? "badge-mcp" : "badge-web"}`}>{p.active ? "active" : "inactive"}</span>
                    </td>
                    <td>
                      <div className="flex justify-end gap-1">
                        <Link href={`/projects/${p.id}`} className="btn btn-sm">Edit</Link>
                        <form action={toggleProjectActiveAction}>
                          <input type="hidden" name="id" value={p.id} />
                          <input type="hidden" name="active" value={p.active ? "false" : "true"} />
                          <SubmitButton className="btn btn-sm" pendingText="…">
                            {p.active ? "Deactivate" : "Activate"}
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
