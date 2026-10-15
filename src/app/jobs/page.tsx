import { EmptyState } from "@/components/EmptyState";
import { Fragment } from "react";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { isInstalled } from "@/plugins/state";
import type { Metadata } from "next";
import { t } from "@/lib/i18n/server";
import { rich } from "@/lib/i18n/rich";
import Link from "next/link";
import { connection } from "next/server";
import { createJobAction } from "@/app/actions";
import { ToggleJobActiveButton } from "@/components/ToggleJobActiveButton";
import { JobForm } from "@/components/JobForm";
import { SubmitButton } from "@/components/SubmitButton";
import { formatHours } from "@/lib/format";
import { listDefaultTagMaps } from "@/lib/default-tags";
import { jobsSlots } from "@/lib/integrations/slots";
import { listJobs } from "@/lib/jobs";
import { listTags } from "@/lib/tags";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Jobs") };
}

export default async function JobsPage() {
  await connection();
  if (!isInstalled("zeiterfassung")) return <PluginNotInstalled id="zeiterfassung" />;
  // What the mounted integrations (Chrono) add: buttons above the table and a column of their own.
  const ext = jobsSlots();
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
          {ext.map((x) => (
            <Fragment key={x.id}>{x.slot.toolbar?.(jobs)}</Fragment>
          ))}
        </div>
        {jobs.length === 0 ? (
          <EmptyState variant="centered">{t("No jobs yet.")}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t("Number")}</th>
                  <th scope="col">{t("Name")}</th>
                  <th scope="col">{t("Customer")}</th>
                  <th scope="col" className="num">{t("Hours")}</th>
                  <th scope="col" className="num">{t("Entries")}</th>
                  {ext.map((x) => (x.slot.column ? <th scope="col" key={x.id} className="text-center">{x.slot.column.title}</th> : null))}
                  <th scope="col">{t("Status")}</th>
                  <th scope="col"><span className="sr-only">{t("Actions")}</span></th>
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
                    {ext.map((x) => (x.slot.column ? <td key={x.id} className="text-center">{x.slot.column.cell(j)}</td> : null))}
                    <td>
                      <span className={`badge ${j.active ? "badge-mcp" : "badge-web"}`}>
                        {j.active ? t("active") : t("inactive")}
                      </span>
                    </td>
                    <td>
                      <div className="flex justify-end gap-1">
                        <Link href={`/jobs/${j.id}`} className="btn btn-sm">{t("Edit")}</Link>
                        <ToggleJobActiveButton id={j.id} active={j.active} number={j.number} />
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
