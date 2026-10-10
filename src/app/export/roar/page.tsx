import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { isInstalled } from "@/plugins/state";
import type { Metadata } from "next";
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

export const metadata: Metadata = { title: "Export to Roar" };

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
          <h1 className="text-lg font-semibold">Export to Roar</h1>
          <p className="text-sm text-zinc-500">
            {week.key} · {formatWeekRange(week)}
            {by ? ` · ${by}` : ""} — pushed to{" "}
            <a href="https://roar.marcel.ai/app/timesheet" target="_blank" rel="noreferrer" className="hover:underline">
              roar.marcel.ai
            </a>
          </p>
        </div>
        <Link href={`/?week=${week.key}${by ? `&by=${encodeURIComponent(by)}` : ""}`} className="btn btn-sm">
          ← Back to week
        </Link>
      </div>

      {plan.unassignedHours > 0 && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          {formatHours(plan.unassignedHours)} h this week are booked on projects without a job and are{" "}
          <strong>not pushed</strong>. Set the job on{" "}
          <Link href="/projects" className="font-medium underline">Projects</Link> first.
        </p>
      )}

      <section className="card p-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-500 uppercase">What will be pushed</h2>
        {plan.rows.length === 0 ? (
          <p className="py-3 text-center text-sm text-zinc-500">Nothing booked in this week.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Job (Roar)</th>
                  {plan.days.map((d) => (
                    <th key={d.iso} className="text-right">{d.label}</th>
                  ))}
                  <th className="text-right">Total</th>
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
                  <td>Total</td>
                  {plan.days.map((d) => {
                    const t = plan.rows.reduce((a, r) => a + (r.hoursByDay[d.iso] ?? 0), 0);
                    return (
                      <td key={d.iso} className="text-right tabular-nums">{t ? formatHours(t) : ""}</td>
                    );
                  })}
                  <td className="text-right tabular-nums">{formatHours(plan.total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-zinc-400">
          Each line of the rewritten weekly report becomes its own Roar entry per job: the line&apos;s label is the
          comment (e.g. <em>Meetings</em> — set in <Link href="/settings" className="underline">Report rewriting</Link>),
          and its hours are rounded <strong>up</strong> to Roar&apos;s 0.1-hour increments. This pushes{" "}
          <span className="tabular-nums font-medium">{plan.entryCount}</span>{" "}
          {plan.entryCount === 1 ? "entry" : "entries"} across {plan.rows.length}{" "}
          {plan.rows.length === 1 ? "job" : "jobs"}; a cell shows the day total, with <span className="text-zinc-500">×n</span>{" "}
          when it holds several entries. Future days are locked by Roar and skipped. Jobs are matched by number (e.g.{" "}
          <code className="code">AB123-000001-00</code>).
        </p>
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase">Transfer</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-zinc-600 dark:text-zinc-300">
          <li>
            The buttons below open Zeff&apos;s own Chrome window if it isn&apos;t running (same as{" "}
            <code className="code">npm run roar:chrome</code>). Sign in to Roar there once — the session is saved.
          </li>
          <li><strong>Check Roar connection</strong> to confirm the automation can attach.</li>
          <li>
            <strong>Dry run</strong> reads Roar and lists every change a fill would make, without saving. Then{" "}
            <strong>Fill in Roar</strong> applies them — you review and Submit in the Roar window (it never submits for
            you).
          </li>
          <li>
            <strong>Safe to rerun — Roar follows Zeff entry by entry:</strong> matching entries stay, a changed duration is
            updated, a missing booking is added, and an entry Zeff no longer has (e.g. a meeting moved to another job) is
            set to 0 h. That clean-up only touches jobs that exist in Zeff, on days you tracked in Zeff{by ? " — and not on this reporter-filtered export, which only adds" : ""}.
          </li>
        </ol>
        {plan.rows.length > 0 && <RoarExportControls week={week.key} by={by} />}
      </section>

      <section className="card p-4">
        <PersistentDetails name="roar-workcodes" ui={ui} className="group">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-zinc-500 uppercase [&::-webkit-details-marker]:hidden">
            <span className="text-zinc-400 transition-transform group-open:rotate-90">▸</span>
            Roar WorkCode per job
            <span className="font-normal normal-case text-zinc-400">(optional)</span>
          </summary>
          <div className="mt-3 space-y-3">
            <p className="text-sm text-zinc-500">
              Most jobs pre-fill a WorkCode from your role. Some (e.g. <strong>Abwesenheit</strong>) start empty and need
              a specific code before Roar will save — set it here so the export picks it automatically.
            </p>
            <RoarWorkcodesForm jobs={jobOptions} current={roarWorkcodes} />
          </div>
        </PersistentDetails>
      </section>
    </div>
  );
}
