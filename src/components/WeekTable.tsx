import Link from "next/link";
import type { WeeklyReport } from "@/lib/entries";
import { formatHours } from "@/lib/format";
import { formatDay, isoDate, todayIso } from "@/lib/week";

export function WeekTable({ report }: { report: WeeklyReport }) {
  const today = todayIso();
  const { week } = report;

  if (report.rows.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-zinc-500">
        No time booked in this week{report.filter.reportedBy ? ` by ${report.filter.reportedBy}` : ""} yet.
      </p>
    );
  }

  const dayClass = (i: number) => {
    const d = week.days[i];
    const cls = ["num"];
    if (isoDate(d) === today) cls.push("bg-indigo-50 dark:bg-indigo-950/40");
    if (i >= 5) cls.push("text-zinc-400 dark:text-zinc-500");
    return cls.join(" ");
  };

  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>Job</th>
            {week.days.map((d, i) => (
              <th key={i} className={dayClass(i)}>
                <div>{formatDay(d, "EEE")}</div>
                <div className="font-normal normal-case">{formatDay(d, "d MMM")}</div>
              </th>
            ))}
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {report.rows.map((row) => (
            <tr key={row.job.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
              <td>
                <Link href={`/jobs/${row.job.id}`} className="font-medium hover:underline">
                  <span className="font-mono whitespace-nowrap">{row.job.number}</span> {row.job.name}
                </Link>
                {row.job.customer && (
                  <div className="text-xs text-zinc-500">{row.job.customer}</div>
                )}
              </td>
              {row.hoursByDay.map((h, i) => (
                <td key={i} className={dayClass(i)}>
                  {h ? formatHours(h) : <span className="text-zinc-300 dark:text-zinc-700">·</span>}
                </td>
              ))}
              <td className="num font-semibold">{formatHours(row.total)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-semibold">
            <td>Total</td>
            {report.dayTotals.map((h, i) => (
              <td key={i} className={dayClass(i)}>
                {h ? formatHours(h) : ""}
              </td>
            ))}
            <td className="num text-base">{formatHours(report.total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
