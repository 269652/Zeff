import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { isInstalled } from "@/plugins/state";
import type { Metadata } from "next";
import { t } from "@/lib/i18n/server";
import { rich } from "@/lib/i18n/rich";
import Link from "next/link";
import { connection } from "next/server";
import { createJobAction, toggleJobActiveAction } from "@/app/actions";
import { JobForm } from "@/components/JobForm";
import { ChronoJobsSyncButton } from "@/components/ChronoJobsSyncButton";
import { StatusIcon } from "@/components/StatusIcon";
import { SubmitButton } from "@/components/SubmitButton";
import { formatDateTime, formatHours } from "@/lib/format";
import { listDefaultTagMaps } from "@/lib/default-tags";
import { listJobs } from "@/lib/jobs";
import { listTags } from "@/lib/tags";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Jobs") };
}

export default async function JobsPage() {
  await connection();
  if (!isInstalled("zeiterfassung")) return <PluginNotInstalled id="zeiterfassung" />;
  const chronoOn = isInstalled("chrono");
  const jobs = listJobs({ includeInactive: true });
  const allTags = listTags().map((tag) => tag.name);
  const defaultTags = listDefaultTagMaps().jobs;

  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">{t("Jobs")}</h1>
        <p className="text-sm text-zinc-500">
          {rich(t("Job numbers that time can be booked on — from the web UI or via the MCP <code>report_time</code> tool."), { code: (s) => <code className="code">{s}</code> })}
        </p>
      </div>

      <section className="card p-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-500 uppercase">{t("New job")}</h2>
        <JobForm action={createJobAction} allTags={allTags} />
      </section>

      <section className="card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("All jobs ({n})", { n: jobs.length })}</h2>
          {chronoOn && <ChronoJobsSyncButton count={jobs.length} />}
        </div>
        {jobs.length === 0 ? (
          <p className="py-4 text-center text-sm text-zinc-500">{t("No jobs yet.")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("Number")}</th>
                  <th>{t("Name")}</th>
                  <th>{t("Customer")}</th>
                  <th className="num">{t("Hours")}</th>
                  <th className="num">{t("Entries")}</th>
                  {chronoOn && <th className="text-center">Chrono</th>}
                  <th>{t("Status")}</th>
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
                          {(defaultTags[j.number] ?? []).map((tag) => (
                            <span key={tag} className="badge badge-tag">#{tag}</span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td>{j.customer ?? ""}</td>
                    <td className="num">{formatHours(j.totalHours)}</td>
                    <td className="num">{j.entryCount}</td>
                    {chronoOn && (
                      <td className="text-center">
                        <ChronoMark job={j} />
                      </td>
                    )}
                    <td>
                      <span className={`badge ${j.active ? "badge-mcp" : "badge-web"}`}>
                        {j.active ? t("active") : t("inactive")}
                      </span>
                    </td>
                    <td>
                      <div className="flex justify-end gap-1">
                        <Link href={`/jobs/${j.id}`} className="btn btn-sm">{t("Edit")}</Link>
                        <form action={toggleJobActiveAction}>
                          <input type="hidden" name="id" value={j.id} />
                          <input type="hidden" name="active" value={j.active ? "false" : "true"} />
                          <SubmitButton className="btn btn-sm" pendingText="…">
                            {j.active ? t("Deactivate") : t("Activate")}
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
  const checked = job.chronoCheckedAt ? ` · ${t("checked {at}", { at: formatDateTime(job.chronoCheckedAt) })}` : "";
  if (job.chronoFound === null) {
    return <span className="text-zinc-300 dark:text-zinc-600" title={t("Not looked up yet — Sync with Chrono")}>–</span>;
  }
  return job.chronoFound ? (
    <span className="inline-flex" title={`${t("In Chrono: {name}", { name: job.chronoName ?? "?" })}${job.chronoClient ? ` (${job.chronoClient})` : ""}${checked}`}>
      <StatusIcon kind="check" className="text-emerald-600 dark:text-emerald-400" />
    </span>
  ) : (
    <span className="inline-flex" title={`${t("Not found in Chrono's job search")}${checked}`}>
      <StatusIcon kind="cross" className="text-red-600 dark:text-red-400" />
    </span>
  );
}
