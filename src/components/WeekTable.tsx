import Link from "next/link";
import { dayShortfalls } from "@/lib/day-status";
import type { WeeklyReport } from "@/lib/entries";
import { formatHours, round2 } from "@/lib/format";
import { t } from "@/lib/i18n/server";
import { totalPauseHours, type PauseRange } from "@/lib/pauses-shared";
import { NO_JOB_NUMBER } from "@/lib/projects-shared";
import { absenceLabels, type AbsenceType } from "@/lib/schedule-shared";
import { integrationClient } from "@/lib/integrations/client";
import type { IntegrationMarks } from "@/lib/integrations/types";
import type { WeekTargets } from "@/lib/schedule";
import { formatDay, isoDate, todayIso } from "@/lib/week";
import { FlexTimeRow, type FlexTimeDay } from "./FlexTimeRow";
import { PauseCell } from "./PauseCell";
import { ProjectWithJob } from "./ProjectWithJob";

/** A row-header cell that looks like the plain cell it replaces (the table style gives th a column-header look). */
const ROW_TH = "border-b border-zinc-100 px-3 py-2 text-left align-top text-sm font-[weight:inherit] tracking-normal text-inherit normal-case dark:border-zinc-800/60";

export function WeekTable({
  report,
  targets,
  pauses,
  lastPauses = [],
  defaultPauses = [],
  marks,
  flex,
}: {
  report: WeeklyReport;
  targets?: WeekTargets;
  /** The week's breaks by ISO date ([] = marked "no break"); shows the editable Pause row when given. */
  pauses?: Record<string, PauseRange[]>;
  /** The latest breaks before this week, offered for days without one. */
  lastPauses?: PauseRange[];
  /** The default break (Schedule), shown greyed out on working days without an entered break. */
  defaultPauses?: PauseRange[];
  /** What the mounted integrations know of the week (Chrono's statuses per entry once pulled, Punch's state per day): marks in the cells and the Booked row. */
  marks?: IntegrationMarks;
  /** The flex-time job (Schedule → Flex time): a shadow row offers it each short day's missing hours. */
  flex?: { job: { id: number; number: string; name: string }; comment: string };
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
  // The integrations' marks: per plugin, its data for the entries of a row on a day (rows are a job, or a project on its job).
  const plugins = Object.entries(marks ?? {}).flatMap(([id, data]) => {
    const client = integrationClient(id);
    return client ? [{ id, client, data }] : [];
  });
  const cellMarks = (row: WeeklyReport["rows"][number], day: string) => {
    const entries = report.entries.filter((e) => e.jobId === row.job.id && (e.projectId ?? null) === (row.project?.id ?? null) && e.date === day);
    return plugins.flatMap((p) => (p.data.entries ? [{ ...p, items: entries.map((e) => p.data.entries![e.id]) }] : []));
  };
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
        {report.filter.reportedBy
          ? t("No time booked in this week by {name} yet.", { name: report.filter.reportedBy })
          : t("No time booked in this week yet.")}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="table">
        <caption className="sr-only">{t("Entries of the week")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("Job")}</th>
            {week.days.map((d, i) => {
              const absence = targets?.absenceByDay[i];
              return (
                <th scope="col" key={i} className={dayClass(i)}>
                  <div className={shortfall[i].state === "missing" ? "text-red-600 dark:text-red-400" : undefined}>
                    {formatDay(d, "EEE")}
                  </div>
                  <div className="font-normal normal-case">{formatDay(d, "d MMM")}</div>
                  {absence ? (
                    <div className="font-normal text-xs tracking-normal text-amber-600 normal-case dark:text-amber-400">
                      {absenceLabels(t)[absence.type as AbsenceType]}
                    </div>
                  ) : nonWorking(i) ? (
                    <div className="font-normal text-xs tracking-normal text-zinc-400 normal-case">{t("off")}</div>
                  ) : null}
                </th>
              );
            })}
            <th scope="col" className="num">{t("Total")}</th>
          </tr>
        </thead>
        <tbody>
          {report.rows.length === 0 ? (
            <tr>
              <td colSpan={9} className="py-6 text-center text-sm text-zinc-500">
                {report.filter.reportedBy
                  ? t("No time booked in this week by {name} yet.", { name: report.filter.reportedBy })
                  : t("No time booked in this week yet.")}
              </td>
            </tr>
          ) : (
            report.rows.map((row) => (
              <tr key={`${row.job.id}:${row.project?.id ?? ""}`} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                <th scope="row" className={ROW_TH}>
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
                </th>
                {row.hoursByDay.map((h, i) => {
                  const cells = h ? cellMarks(row, isoDays[i]) : [];
                  const approved = cells.find((c) => c.client.cellApproved?.(c.items));
                  return (
                    <td key={i} className={`${dayClass(i)} ${approved?.client.approvedClass ?? ""}`}>
                      {h ? formatHours(h) : <span className="text-zinc-300 dark:text-zinc-700">·</span>}
                      {cells.map((c) => (c.client.CellMark && c.items.length > 0 ? <c.client.CellMark key={c.id} items={c.items} /> : null))}
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
            <th scope="row" className={ROW_TH}>{t("Booked")}</th>
            {report.dayTotals.map((h, i) => (
              <td
                key={i}
                className={bookedClass(i)}
                title={shortfall[i].state === "ok" ? undefined : t("{hours} h below the target", { hours: formatHours(shortfall[i].gap) })}
              >
                {h ? formatHours(h) : shortfall[i].state === "ok" ? "" : "0"}
                {shortfall[i].state !== "ok" && (
                  <span className="sr-only">
                    {shortfall[i].state === "short"
                      ? t("{hours} h below the target (day not over yet)", { hours: formatHours(shortfall[i].gap) })
                      : t("{hours} h below the target", { hours: formatHours(shortfall[i].gap) })}
                  </span>
                )}
                {plugins.map((p) => (p.client.DayMark && p.data.days?.[i] ? <p.client.DayMark key={p.id} item={p.data.days[i]} /> : null))}
              </td>
            ))}
            <td className="num text-base">{formatHours(report.total)}</td>
          </tr>
          {missingTotal > 0 && (
            <tr className="font-semibold text-red-600 dark:text-red-400">
              <th scope="row" className={ROW_TH}>{t("Missing")}</th>
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
              <th scope="row" className={ROW_TH}>{t("Target")}</th>
              {targets.targets.map((h, i) => (
                <td key={i} className={`num ${nonWorking(i) ? "bg-zinc-50 dark:bg-zinc-900/60" : ""}`}>
                  {h ? formatHours(h) : ""}
                </td>
              ))}
              <td className="num">{formatHours(targets.weekTarget)}</td>
            </tr>
          )}
          {pauses && (
            <tr className="text-zinc-600 dark:text-zinc-300">
              <th scope="row" className={ROW_TH}>{t("Pause")}</th>
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
