import Link from "next/link";
import { dayShortfalls } from "@/lib/day-status";
import type { WeeklyReport } from "@/lib/entries";
import { formatHours, round2 } from "@/lib/format";
import { totalPauseHours, type PauseRange } from "@/lib/pauses-shared";
import { NO_JOB_NUMBER } from "@/lib/projects-shared";
import { ABSENCE_LABELS, type AbsenceType } from "@/lib/schedule-shared";
import { aggregateChronoKind, type EntryChronoStatus } from "@/lib/chrono-status";
import type { WeekTargets } from "@/lib/schedule";
import type { PunchDayState } from "@/lib/punch-status";
import { formatDay, isoDate, todayIso } from "@/lib/week";
import { FlexTimeRow, type FlexTimeDay } from "./FlexTimeRow";
import { PauseCell } from "./PauseCell";
import { PunchMark } from "./PunchMark";
import { ChronoCellMark, CHRONO_APPROVED_TEXT } from "./ChronoMark";
import { ProjectWithJob } from "./ProjectWithJob";

export function WeekTable({
  report,
  targets,
  pauses,
  lastPauses = [],
  defaultPauses = [],
  chronoStatuses,
  flex,
  punch,
}: {
  report: WeeklyReport;
  targets?: WeekTargets;
  /** The week's breaks by ISO date ([] = marked "no break"); shows the editable Pause row when given. */
  pauses?: Record<string, PauseRange[]>;
  /** The latest breaks before this week, offered for days without one. */
  lastPauses?: PauseRange[];
  /** The default break (Schedule), shown greyed out on working days without an entered break. */
  defaultPauses?: PauseRange[];
  /** Chrono statuses by entry id, once the week was pulled — marks each cell (approved hours read green). */
  chronoStatuses?: Record<number, EntryChronoStatus>;
  /** The flex-time job (Schedule → Flex time): a shadow row offers it each short day's missing hours. */
  flex?: { job: { id: number; number: string; name: string }; comment: string };
  /** Each day against Punch, as last read ("Pull Punch"): marks in the Booked row. */
  punch?: (PunchDayState | undefined)[];
}) {
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

  // Days under their target: "missing" once the day is over, "short" while it is today.
  const shortfall = dayShortfalls(week, report.dayTotals, targets?.targets, {
    today,
    filtered: !!report.filter.reportedBy,
  });
  const missingTotal = round2(shortfall.reduce((a, s) => a + (s.state === "missing" ? s.gap : 0), 0));
  const bookedClass = (i: number) =>
    shortfall[i].state === "missing"
      ? "num bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"
      : shortfall[i].state === "short"
        ? "num bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
        : dayClass(i);

  // Breaks: a day without one is offered the latest earlier break (this week's, else lastPauses).
  const isoDays = week.days.map(isoDate);
  // Chrono statuses of a row's entries on a day (rows are a job, or a project on its job).
  const cellStatuses = (row: WeeklyReport["rows"][number], day: string) =>
    report.entries
      .filter((e) => e.jobId === row.job.id && (e.projectId ?? null) === (row.project?.id ?? null) && e.date === day)
      .map((e) => chronoStatuses?.[e.id]);
  const pauseSuggestion = (i: number): PauseRange[] => {
    for (let j = i - 1; j >= 0; j--) if (pauses?.[isoDays[j]]?.length) return pauses[isoDays[j]];
    return lastPauses;
  };
  const isWorkday = (i: number) => (targets ? targets.targets[i] > 0 : i < 5);
  const workdays = isoDays.filter((_, i) => isWorkday(i));
  // The default break shows on working days (and days with bookings) where nothing is entered.
  const pauseShadow = (i: number): PauseRange[] =>
    pauses?.[isoDays[i]] === undefined && (isWorkday(i) || report.dayTotals[i] > 0) ? defaultPauses : [];
  const pauseTotal = round2(isoDays.reduce((a, d) => a + totalPauseHours(pauses?.[d] ?? []), 0));
  // Flex time: the days so far that aren't fully booked (never in a reporter-filtered view — see dayShortfalls).
  const flexDays: FlexTimeDay[] = isoDays.map((iso, i) => ({
    iso,
    label: formatDay(week.days[i], "EEE d MMM"),
    gap: shortfall[i].state === "ok" ? 0 : shortfall[i].gap,
    className: dayClass(i),
  }));
  const showFlex = !!flex && flexDays.some((d) => d.gap > 0);

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
                  <div className={shortfall[i].state === "missing" ? "text-red-600 dark:text-red-400" : undefined}>
                    {formatDay(d, "EEE")}
                  </div>
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
                {row.hoursByDay.map((h, i) => {
                  const statuses = h && chronoStatuses ? cellStatuses(row, isoDays[i]) : [];
                  const approved = aggregateChronoKind(statuses) === "approved";
                  return (
                    <td key={i} className={`${dayClass(i)} ${approved ? CHRONO_APPROVED_TEXT : ""}`}>
                      {h ? formatHours(h) : <span className="text-zinc-300 dark:text-zinc-700">·</span>}
                      {statuses.length > 0 && <ChronoCellMark statuses={statuses} />}
                    </td>
                  );
                })}
                <td className="num font-semibold">{formatHours(row.total)}</td>
              </tr>
            ))
          )}
          {showFlex && flex && <FlexTimeRow job={flex.job} comment={flex.comment} days={flexDays} />}
        </tbody>
        <tfoot>
          <tr className="font-semibold">
            <td>Booked</td>
            {report.dayTotals.map((h, i) => (
              <td
                key={i}
                className={bookedClass(i)}
                title={shortfall[i].state === "ok" ? undefined : `${formatHours(shortfall[i].gap)} h below the target`}
              >
                {h ? formatHours(h) : shortfall[i].state === "ok" ? "" : "0"}
                {punch?.[i] && <PunchMark day={punch[i]} />}
              </td>
            ))}
            <td className="num text-base">{formatHours(report.total)}</td>
          </tr>
          {missingTotal > 0 && (
            <tr className="font-semibold text-red-600 dark:text-red-400">
              <td>Missing</td>
              {shortfall.map((s, i) => (
                <td key={i} className={`num ${s.state === "missing" ? "bg-red-50 dark:bg-red-950/40" : ""}`}>
                  {s.state === "missing" ? formatHours(s.gap) : ""}
                </td>
              ))}
              <td className="num">{formatHours(missingTotal)}</td>
            </tr>
          )}
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
          {pauses && (
            <tr className="text-zinc-600 dark:text-zinc-300">
              <td>Pause</td>
              {week.days.map((d, i) => (
                <td key={i} className={`num align-top ${nonWorking(i) ? "bg-zinc-50 dark:bg-zinc-900/60" : ""}`}>
                  <PauseCell
                    date={isoDays[i]}
                    dayLabel={formatDay(d, "EEE d MMM")}
                    pauses={pauses[isoDays[i]] ?? []}
                    noBreak={pauses[isoDays[i]]?.length === 0}
                    shadow={pauseShadow(i)}
                    suggestion={pauseSuggestion(i)}
                    workdays={workdays}
                  />
                </td>
              ))}
              <td className="num align-top">{pauseTotal ? formatHours(pauseTotal) : ""}</td>
            </tr>
          )}
        </tfoot>
      </table>
    </div>
  );
}
