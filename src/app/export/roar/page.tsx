import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { isInstalled } from "@/plugins/state";
import type { Metadata } from "next";
import { t } from "@/lib/i18n/server";
import { rich } from "@/lib/i18n/rich";
import Link from "next/link";
import { connection } from "next/server";
import { PersistentDetails } from "@/components/PersistentDetails";
import { RoarExportControls } from "@/components/RoarExportControls";
import { RoarWorkcodesForm } from "@/components/RoarWorkcodesForm";
import { formatHours } from "@/lib/format";
import { listJobs } from "@/lib/jobs";
import { getReportSettings, getRoarWorkcodes } from "@/lib/report";
import { getRoarExportPlan } from "@/lib/roar";
import { getUiOpen } from "@/lib/ui-state";
import { currentWeek, formatWeekRange, resolveWeek } from "@/lib/week";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Export to Roar") };
}

export default async function RoarExportPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; by?: string }>;
}) {
  await connection();
  // A plugin's page: there while it's installed.
  if (!isInstalled("roar")) return <PluginNotInstalled id="roar" />;
  const sp = await searchParams;
  const week = resolveWeek(sp.week) ?? currentWeek();
  const by = sp.by?.trim() || undefined;
  const plan = getRoarExportPlan(week, { reportedBy: by });
  const jobOptions = listJobs().map((j) => ({ number: j.number, name: j.name }));
  const roarWorkcodes = getRoarWorkcodes(getReportSettings());
  const ui = await getUiOpen();

  return (
    <div className="page">
      <div className="page-aside">
        <div>
          <h1 className="text-lg font-semibold">{t("Export to Roar")}</h1>
          <p className="text-sm text-zinc-500">
            {week.key} · {formatWeekRange(week)}
            {by ? ` · ${by}` : ""}{" "}
            {rich(t("— pushed to <link>roar.marcel.ai</link>"), {
              link: (s) => (
                <a href="https://roar.marcel.ai/app/timesheet" target="_blank" rel="noreferrer" className="hover:underline">
                  {s}
                </a>
              ),
            })}
          </p>
        </div>
        <Link href={`/?week=${week.key}${by ? `&by=${encodeURIComponent(by)}` : ""}`} className="btn btn-sm">
          {t("← Back to week")}
        </Link>
      </div>

      {plan.unassignedHours > 0 && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          {rich(
            t(
              "{hours} h this week are booked on projects without a job and are <b>not pushed</b>. Set the job on <link>Projects</link> first.",
              { hours: formatHours(plan.unassignedHours) },
            ),
            {
              b: (s) => <strong>{s}</strong>,
              link: (s) => <Link href="/projects" className="font-medium underline">{s}</Link>,
            },
          )}
        </p>
      )}

      <section className="card p-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-500 uppercase">{t("What will be pushed")}</h2>
        {plan.rows.length === 0 ? (
          <p className="py-3 text-center text-sm text-zinc-500">{t("Nothing booked in this week.")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("Job (Roar)")}</th>
                  {plan.days.map((d) => (
                    <th key={d.iso} className="text-right">{d.label}</th>
                  ))}
                  <th className="text-right">{t("Total")}</th>
                </tr>
              </thead>
              <tbody>
                {plan.rows.map((r) => (
                  <tr key={r.jobNumber}>
                    <td className="whitespace-nowrap">
                      <span className="font-mono">{r.jobNumber}</span> <span className="text-zinc-500">{r.jobName}</span>
                    </td>
                    {plan.days.map((d) => {
                      const n = r.entriesByDay[d.iso]?.length ?? 0;
                      return (
                        <td key={d.iso} className="text-right tabular-nums">
                          {r.hoursByDay[d.iso] ? (
                            <>
                              {formatHours(r.hoursByDay[d.iso])}
                              {n > 1 ? <span className="ml-0.5 text-xs text-zinc-400">×{n}</span> : null}
                            </>
                          ) : (
                            <span className="text-zinc-300 dark:text-zinc-700">·</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="text-right font-medium tabular-nums">{formatHours(r.total)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-zinc-200 font-semibold dark:border-zinc-700">
                  <td>{t("Total")}</td>
                  {plan.days.map((d) => {
                    const sum = plan.rows.reduce((a, r) => a + (r.hoursByDay[d.iso] ?? 0), 0);
                    return (
                      <td key={d.iso} className="text-right tabular-nums">{sum ? formatHours(sum) : ""}</td>
                    );
                  })}
                  <td className="text-right tabular-nums">{formatHours(plan.total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-zinc-400">
          {rich(
            t(
              "Each line of the rewritten weekly report becomes its own Roar entry per job: the line's label is the comment (e.g. <em>Meetings</em> — set in <link>Report rewriting</link>), and its hours are rounded <b>up</b> to Roar's 0.1-hour increments.",
            ),
            {
              em: (s) => <em>{s}</em>,
              link: (s) => <Link href="/settings" className="underline">{s}</Link>,
              b: (s) => <strong>{s}</strong>,
            },
          )}{" "}
          {rich(
            t("This pushes {entries} across {jobs}; a cell shows the day total, with <x>×n</x> when it holds several entries.", {
              entries: plan.entryCount === 1 ? t("<n>1</n> entry") : t("<n>{n}</n> entries", { n: plan.entryCount }),
              jobs: plan.rows.length === 1 ? t("1 job") : t("{n} jobs", { n: plan.rows.length }),
            }),
            {
              n: (s) => <span className="tabular-nums font-medium">{s}</span>,
              x: (s) => <span className="text-zinc-500">{s}</span>,
            },
          )}{" "}
          {rich(t("Future days are locked by Roar and skipped. Jobs are matched by number (e.g. <code>AB123-000001-00</code>)."), {
            code: (s) => <code className="code">{s}</code>,
          })}
        </p>
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Transfer")}</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-zinc-600 dark:text-zinc-300">
          <li>
            {rich(
              t(
                "The buttons below open Zeff's own Chrome window if it isn't running (same as <code>npm run roar:chrome</code>). Sign in to Roar there once — the session is saved.",
              ),
              { code: (s) => <code className="code">{s}</code> },
            )}
          </li>
          <li>
            {rich(t("<b>Check Roar connection</b> to confirm the automation can attach."), { b: (s) => <strong>{s}</strong> })}
          </li>
          <li>
            {rich(
              t(
                "<b>Dry run</b> reads Roar and lists every change a fill would make, without saving. Then <b>Fill in Roar</b> applies them — you review and Submit in the Roar window (it never submits for you).",
              ),
              { b: (s) => <strong>{s}</strong> },
            )}
          </li>
          <li>
            {rich(
              by
                ? t(
                    "<b>Safe to rerun — Roar follows Zeff entry by entry:</b> matching entries stay, a changed duration is updated, a missing booking is added, and an entry Zeff no longer has (e.g. a meeting moved to another job) is set to 0 h. That clean-up only touches jobs that exist in Zeff, on days you tracked in Zeff — and not on this reporter-filtered export, which only adds.",
                  )
                : t(
                    "<b>Safe to rerun — Roar follows Zeff entry by entry:</b> matching entries stay, a changed duration is updated, a missing booking is added, and an entry Zeff no longer has (e.g. a meeting moved to another job) is set to 0 h. That clean-up only touches jobs that exist in Zeff, on days you tracked in Zeff.",
                  ),
              { b: (s) => <strong>{s}</strong> },
            )}
          </li>
        </ol>
        {plan.rows.length > 0 && <RoarExportControls week={week.key} by={by} />}
      </section>

      <section className="card p-4">
        <PersistentDetails name="roar-workcodes" ui={ui} className="group">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-zinc-500 uppercase [&::-webkit-details-marker]:hidden">
            <span className="text-zinc-400 transition-transform group-open:rotate-90">▸</span>
            {t("Roar WorkCode per job")}
            <span className="font-normal normal-case text-zinc-400">{t("(optional)")}</span>
          </summary>
          <div className="mt-3 space-y-3">
            <p className="text-sm text-zinc-500">
              {rich(
                t(
                  "Most jobs pre-fill a WorkCode from your role. Some (e.g. <b>Abwesenheit</b>) start empty and need a specific code before Roar will save — set it here so the export picks it automatically.",
                ),
                { b: (s) => <strong>{s}</strong> },
              )}
            </p>
            <RoarWorkcodesForm jobs={jobOptions} current={roarWorkcodes} />
          </div>
        </PersistentDetails>
      </section>
    </div>
  );
}
