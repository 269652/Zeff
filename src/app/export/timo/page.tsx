import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { isInstalled } from "@/plugins/state";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { TimoConfigForm } from "@/components/TimoConfigForm";
import { TimoExportControls } from "@/components/TimoExportControls";
import { formatHours } from "@/lib/format";
import { listJobs } from "@/lib/jobs";
import { getReportSettings, getTimoConfig } from "@/lib/report";
import { computeEnd, getTimoExportPlan } from "@/lib/timo";
import { currentWeek, formatWeekRange, resolveWeek } from "@/lib/week";

export const metadata: Metadata = { title: "Export to TimO" };

export default async function TimoExportPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; by?: string; gaps?: string }>;
}) {
  await connection();
  // A plugin's page: there while it's installed.
  if (!isInstalled("timo")) return <PluginNotInstalled id="timo" />;
  const sp = await searchParams;
  const week = resolveWeek(sp.week) ?? currentWeek();
  const by = sp.by?.trim() || undefined;
  const fillGaps = sp.gaps === "1";
  const config = getTimoConfig(getReportSettings());
  const jobOptions = listJobs().map((j) => ({ number: j.number, name: j.name }));
  const plan = getTimoExportPlan(week, config, { reportedBy: by, fillGaps });
  const qp = (extra: Record<string, string>) =>
    new URLSearchParams({ week: week.key, ...(by ? { by } : {}), ...extra }).toString();

  return (
    <div className="page">
      <div className="page-aside">
        <div>
          <h1 className="text-lg font-semibold">Export to TimO</h1>
          <p className="text-sm text-zinc-500">
            {week.key} · {formatWeekRange(week)}
            {by ? ` · ${by}` : ""} — working time to{" "}
            <a href="https://ac.timo24.de/timo/index.jsp" target="_blank" rel="noreferrer" className="hover:underline">
              ac.timo24.de
            </a>
          </p>
        </div>
        <Link href={`/?week=${week.key}${by ? `&by=${encodeURIComponent(by)}` : ""}`} className="btn btn-sm">
          ← Back to week
        </Link>
      </div>

      <section className="card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">What will be recorded</h2>
          <div className="flex items-center gap-1">
            <Link href={`/export/timo?${qp({})}`} className={`btn btn-sm ${fillGaps ? "" : "btn-primary"}`}>Booked only</Link>
            <Link href={`/export/timo?${qp({ gaps: "1" })}`} className={`btn btn-sm ${fillGaps ? "btn-primary" : ""}`}>Fill gaps 8h</Link>
          </div>
        </div>
        {plan.days.length === 0 ? (
          <p className="py-3 text-center text-sm text-zinc-500">
            Nothing booked this week. Turn on <strong>Fill gaps 8h</strong> to record a default day on your workdays.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Start</th>
                  <th>Break</th>
                  <th>End</th>
                  <th className="text-right">Hours</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {plan.days.map((d) => (
                  <tr key={`${d.iso}-${d.kind}`}>
                    <td className="whitespace-nowrap">{d.label} <span className="font-mono text-xs text-zinc-400">{d.iso}</span></td>
                    <td className="font-mono tabular-nums">{d.kind === "absence" ? "—" : d.start}</td>
                    <td className="font-mono whitespace-nowrap tabular-nums">
                      {d.breaks?.length ? (
                        <>
                          {d.breaks.map((b) => `${b.start}–${b.end}`).join(", ")}
                          {d.breakSource === "default" && <span className="ml-1 font-sans text-xs text-zinc-400">default</span>}
                        </>
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </td>
                    <td className="font-mono tabular-nums">{d.kind === "absence" ? "—" : d.end}</td>
                    <td className="text-right tabular-nums">{formatHours(d.hours)}</td>
                    <td>
                      {d.kind === "absence" ? (
                        <span className="badge bg-indigo-100 text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-300">
                          Absence · {d.absenceType}
                          {d.halfDay ? " · ½ day" : ""}
                        </span>
                      ) : (
                        <span className={`badge ${d.source === "gap" ? "badge-web" : "badge-mcp"}`}>
                          {d.source === "gap" ? "8h default" : "Zeff"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-zinc-200 font-semibold dark:border-zinc-700">
                  <td colSpan={4}>Total</td>
                  <td className="text-right tabular-nums">{formatHours(plan.total)}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-zinc-400">
          Working days record Kommt at the start and Geht at the end, with Pause Start/Pause Ende around each break
          from the weekly Pause row — or the default break from <Link href="/settings" className="underline">Schedule</Link> when
          enabled there. Recorded breaks count toward TimO&apos;s automatic break; a day over 6 h without enough of them gets
          the missing minutes added to its end (e.g. no break: {config.startTime} + {config.workdayHours}h +{" "}
          {config.breakMinutes} min → <span className="font-mono">{computeEnd(config.startTime, config.workdayHours, config.breakMinutes)}</span>).
          Entries on the <strong>absence job</strong> are booked in TimO&apos;s absence form as{" "}
          <strong>{config.absenceType}</strong> — up to half a work day as a half day.
        </p>
        {plan.flex.length > 0 && (
          <p className="mt-2 text-xs text-zinc-500">
            <strong>Flex time (Gleitzeit)</strong> isn&apos;t recorded as working time — TimO&apos;s flex-time balance goes
            down by it: {plan.flex.map((f) => `${f.label} · ${formatHours(f.hours)} h`).join(", ")}.
          </p>
        )}
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase">TimO settings</h2>
        <TimoConfigForm config={config} jobs={jobOptions} />
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase">Transfer</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-zinc-600 dark:text-zinc-300">
          <li>
            The buttons below open Zeff&apos;s own Chrome window (the one used for Roar) if it isn&apos;t running. Sign in
            to TimO there once and leave it on the <strong>Zeitbuchung</strong> view.
          </li>
          <li><strong>Check TimO connection</strong>, then <strong>Dry run</strong> — it fills and validates each day&apos;s TimO form without saving.</li>
          <li>
            <strong>Fill in TimO</strong> saves each day as Kommt/Geht bookings and absences in TimO&apos;s absence form. Days
            TimO already has with the same times are skipped; a day with other times is replaced — deleted in TimO and
            booked again (clock-ins from a terminal or the TimO app are never touched). The dry run lists what it would
            replace.
          </li>
        </ol>
        <TimoExportControls week={week.key} by={by} fillGaps={fillGaps} />
      </section>
    </div>
  );
}
