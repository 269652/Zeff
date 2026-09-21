import Link from "next/link";
import type { WeeklyReport } from "@/lib/entries";
import { formatHours } from "@/lib/format";
import { ABSENCE_LABELS, type AbsenceType } from "@/lib/schedule-shared";
import type { WeekTargets } from "@/lib/schedule";
import { formatDay, isoDate, todayIso } from "@/lib/week";

export function WeekTable({ report, targets }: { report: WeeklyReport; targets?: WeekTargets }) {
  const today = todayIso();
  const { week } = report;

  const nonWorking = (i: number) => targets !== undefined && targets.targets[i] === 0;

  const dayClass = (i: number) => {
    const d = week.days[i];
    const cls = ["num"];
    if (isoDate(d) === today) cls.push("bg-indigo-50 dark:bg-indigo-950/40");
    else if (nonWorking(i)) cls.push("bg-zinc-50 dark:bg-zinc-900/60");
    if (i >= 5) cls.push("text-zinc-400 dark:text-zinc-500");
    return cls.join(" ");
  };

  if (report.rows.length === 0 && !targets) {
    return (
      <p className="py-6 text-center text-sm text-zinc-500">
        No time booked in this week{report.filter.reportedBy ? ` by ${report.filter.reportedBy}` : ""} yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>Job</th>
            {week.days.map((d, i) => {
              const absence = targets?.absenceByDay[i];
              return (
                <th key={i} className={dayClass(i)}>
                  <div>{formatDay(d, "EEE")}</div>
                  <div className="font-normal normal-case">{formatDay(d, "d MMM")}</div>
                  {absence ? (
                    <div className="font-normal text-[10px] tracking-normal text-amber-600 normal-case dark:text-amber-400">
                      {ABSENCE_LABELS[absence.type as AbsenceType]}
                    </div>
                  ) : nonWorking(i) ? (
                    <div className="font-normal text-[10px] tracking-normal text-zinc-400 normal-case">off</div>
                  ) : null}
                </th>
              );
            })}
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {report.rows.length === 0 ? (
            <tr>
              <td colSpan={9} className="py-6 text-center text-sm text-zinc-500">
                No time booked in this week{report.filter.reportedBy ? ` by ${report.filter.reportedBy}` : ""} yet.
              </td>
            </tr>
          ) : (
            report.rows.map((row) => (
              <tr key={row.job.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                <td>
                  <Link href={`/jobs/${row.job.id}`} className="font-medium hover:underline">
                    <span className="font-mono whitespace-nowrap">{row.job.number}</span> {row.job.name}
                  </Link>
                  {row.job.customer && <div className="text-xs text-zinc-500">{row.job.customer}</div>}
                </td>
                {row.hoursByDay.map((h, i) => (
                  <td key={i} className={dayClass(i)}>
                    {h ? formatHours(h) : <span className="text-zinc-300 dark:text-zinc-700">·</span>}
                  </td>
                ))}
                <td className="num font-semibold">{formatHours(row.total)}</td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr className="font-semibold">
            <td>Booked</td>
            {report.dayTotals.map((h, i) => (
              <td key={i} className={dayClass(i)}>
                {h ? formatHours(h) : ""}
              </td>
            ))}
            <td className="num text-base">{formatHours(report.total)}</td>
          </tr>
          {targets && (
            <tr className="text-zinc-500">
              <td>Target</td>
              {targets.targets.map((t, i) => (
                <td key={i} className={`num ${nonWorking(i) ? "bg-zinc-50 dark:bg-zinc-900/60" : ""}`}>
                  {t ? formatHours(t) : ""}
                </td>
              ))}
              <td className="num">{formatHours(targets.weekTarget)}</td>
            </tr>
          )}
        </tfoot>
      </table>
    </div>
  );
}
