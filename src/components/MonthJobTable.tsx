import Link from "next/link";
import { formatHours, round2 } from "@/lib/format";
import { t } from "@/lib/i18n/server";
import { weekRangeInMonth } from "@/lib/month";
import type { MonthlyReport } from "@/lib/monthly";
import { NO_JOB_NUMBER } from "@/lib/projects-shared";
import { ProjectWithJob } from "./ProjectWithJob";

/** Hours per job (and project) and week of the month, with each week's booked, missing and target hours. */
export function MonthJobTable({
  report,
  weekTargets,
  weekMissing,
}: {
  report: MonthlyReport;
  /** Target per week of the month (only its days). */
  weekTargets: number[];
  /** Hours missing on past days, per week of the month. */
  weekMissing: number[];
}) {
  const { month } = report;
  const monthTarget = round2(weekTargets.reduce((a, b) => a + b, 0));
  const missingTotal = round2(weekMissing.reduce((a, b) => a + b, 0));
  const share = (h: number) => (report.total > 0 ? `${Math.round((h / report.total) * 100)}%` : "");

  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>{t("Job")}</th>
            {month.weeks.map((w) => (
              <th key={w.key} className="num">
                <Link href={`/?week=${w.key}`} className="hover:underline">
                  {t("W{week}", { week: w.week })}
                </Link>
                <div className="font-normal normal-case">{weekRangeInMonth(w, month)}</div>
              </th>
            ))}
            <th className="num">{t("Total")}</th>
            <th className="num">{t("Share")}</th>
          </tr>
        </thead>
        <tbody>
          {report.rows.length === 0 ? (
            <tr>
              <td colSpan={month.weeks.length + 3} className="py-6 text-center text-sm text-zinc-500">
                {report.filter.reportedBy
                  ? t("No time booked in this month by {name}.", { name: report.filter.reportedBy })
                  : t("No time booked in this month.")}
              </td>
            </tr>
          ) : (
            report.rows.map((row) => (
              <tr key={`${row.job.id}:${row.project?.id ?? ""}`} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                <td>
                  {row.project ? (
                    <ProjectWithJob project={row.project} job={row.job} />
                  ) : row.job.number === NO_JOB_NUMBER ? (
                    <Link href="/projects" className="badge badge-nojob hover:underline">{row.job.name}</Link>
                  ) : (
                    <>
                      <Link href={`/jobs/${row.job.id}`} className="font-medium hover:underline">
                        <span className="font-mono whitespace-nowrap">{row.job.number}</span> {row.job.name}
                      </Link>
                      {row.job.customer && <div className="text-xs text-zinc-500">{row.job.customer}</div>}
                    </>
                  )}
                </td>
                {row.hoursByWeek.map((h, i) => (
                  <td key={i} className="num">
                    {h ? formatHours(h) : <span className="text-zinc-300 dark:text-zinc-700">·</span>}
                  </td>
                ))}
                <td className="num font-semibold">{formatHours(row.total)}</td>
                <td className="num text-zinc-500">{share(row.total)}</td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr className="font-semibold">
            <td>{t("Booked")}</td>
            {report.weekTotals.map((h, i) => (
              <td key={i} className="num">{h ? formatHours(h) : ""}</td>
            ))}
            <td className="num text-base">{formatHours(report.total)}</td>
            <td />
          </tr>
          {missingTotal > 0 && (
            <tr className="font-semibold text-red-600 dark:text-red-400">
              <td>{t("Missing")}</td>
              {weekMissing.map((m, i) => (
                <td key={i} className={`num ${m > 0 ? "bg-red-50 dark:bg-red-950/40" : ""}`}>{m > 0 ? formatHours(m) : ""}</td>
              ))}
              <td className="num">{formatHours(missingTotal)}</td>
              <td />
            </tr>
          )}
          <tr className="text-zinc-500">
            <td>{t("Target")}</td>
            {weekTargets.map((h, i) => (
              <td key={i} className="num">{h ? formatHours(h) : ""}</td>
            ))}
            <td className="num">{formatHours(monthTarget)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
