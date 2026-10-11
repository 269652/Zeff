import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { isInstalled } from "@/plugins/state";
import type { Metadata } from "next";
import { t } from "@/lib/i18n/server";
import Link from "next/link";
import { connection } from "next/server";
import { TimoConfigForm } from "@/components/TimoConfigForm";
import { TimoExportControls } from "@/components/TimoExportControls";
import { formatHours } from "@/lib/format";
import { listJobs } from "@/lib/jobs";
import { getReportSettings, getTimoConfig } from "@/lib/report";
import { computeEnd, getTimoExportPlan } from "@/lib/timo";
import { currentWeek, formatWeekRange, resolveWeek } from "@/lib/week";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Export to TimO") };
}

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
          <h1 className="text-lg font-semibold">{t("Export to TimO")}</h1>
          <p className="text-sm text-zinc-500">
            {week.key} · {formatWeekRange(week)}
            {by ? ` · ${by}` : ""} {t("— working time to")}{" "}
            <a href="https://ac.timo24.de/timo/index.jsp" target="_blank" rel="noreferrer" className="hover:underline">
              ac.timo24.de
            </a>
          </p>
        </div>
        <Link href={`/?week=${week.key}${by ? `&by=${encodeURIComponent(by)}` : ""}`} className="btn btn-sm">
          {t("← Back to week")}
        </Link>
      </div>

      <section className="card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("What will be recorded")}</h2>
          <div className="flex items-center gap-1">
            <Link href={`/export/timo?${qp({})}`} className={`btn btn-sm ${fillGaps ? "" : "btn-primary"}`}>{t("Booked only")}</Link>
            <Link href={`/export/timo?${qp({ gaps: "1" })}`} className={`btn btn-sm ${fillGaps ? "btn-primary" : ""}`}>{t("Fill gaps 8h")}</Link>
          </div>
        </div>
        {plan.days.length === 0 ? (
          <p className="py-3 text-center text-sm text-zinc-500">
            {t("Nothing booked this week. Turn on")} <strong>{t("Fill gaps 8h")}</strong> {t("to record a default day on your workdays.")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("Day")}</th>
                  <th>{t("Start")}</th>
                  <th>{t("Break")}</th>
                  <th>{t("End")}</th>
                  <th className="text-right">{t("Hours")}</th>
                  <th>{t("Source")}</th>
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
                          {d.breakSource === "default" && <span className="ml-1 font-sans text-xs text-zinc-400">{t("default")}</span>}
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
                          {t("Absence · {type}", { type: d.absenceType ?? "" })}
                          {d.halfDay ? ` · ${t("½ day")}` : ""}
                        </span>
                      ) : (
                        <span className={`badge ${d.source === "gap" ? "badge-web" : "badge-mcp"}`}>
                          {d.source === "gap" ? t("8h default") : "Zeff"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-zinc-200 font-semibold dark:border-zinc-700">
                  <td colSpan={4}>{t("Total")}</td>
                  <td className="text-right tabular-nums">{formatHours(plan.total)}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-zinc-400">
          {t("Working days record Kommt at the start and Geht at the end, with Pause Start/Pause Ende around each break from the weekly Pause row — or the default break from")}{" "}
          <Link href="/settings" className="underline">{t("Schedule")}</Link>{" "}
          {t("when enabled there. Recorded breaks count toward TimO's automatic break; a day over 6 h without enough of them gets the missing minutes added to its end (e.g. no break: {start} + {hours}h + {minutes} min →", {
            start: config.startTime,
            hours: config.workdayHours,
            minutes: config.breakMinutes,
          })}{" "}
          <span className="font-mono">{computeEnd(config.startTime, config.workdayHours, config.breakMinutes)}</span>).{" "}
          {t("Entries on the")} <strong>{t("absence job")}</strong> {t("are booked in TimO's absence form as")}{" "}
          <strong>{config.absenceType}</strong> {t("— up to half a work day as a half day.")}
        </p>
        {plan.flex.length > 0 && (
          <p className="mt-2 text-xs text-zinc-500">
            <strong>{t("Flex time (Gleitzeit)")}</strong>{" "}
            {t("isn't recorded as working time — TimO's flex-time balance goes down by it: {days}.", {
              days: plan.flex.map((f) => `${f.label} · ${formatHours(f.hours)} h`).join(", "),
            })}
          </p>
        )}
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("TimO settings")}</h2>
        <TimoConfigForm config={config} jobs={jobOptions} />
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Transfer")}</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-zinc-600 dark:text-zinc-300">
          <li>
            {t("The buttons below open Zeff's own Chrome window (the one used for Roar) if it isn't running. Sign in to TimO there once and leave it on the")}{" "}
            <strong>Zeitbuchung</strong> {t("view.")}
          </li>
          <li>
            <strong>{t("Check TimO connection")}</strong>
            {t(", then")} <strong>{t("Dry run")}</strong> {t("— it fills and validates each day's TimO form without saving.")}
          </li>
          <li>
            <strong>{t("Fill in TimO")}</strong>{" "}
            {t(
              "saves each day as Kommt/Geht bookings and absences in TimO's absence form. Days TimO already has with the same times are skipped; a day with other times is replaced — deleted in TimO and booked again (clock-ins from a terminal or the TimO app are never touched). The dry run lists what it would replace.",
            )}
          </li>
        </ol>
        <TimoExportControls week={week.key} by={by} fillGaps={fillGaps} />
      </section>
    </div>
  );
}
