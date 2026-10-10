import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { isInstalled } from "@/plugins/state";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { BarList, type BarItem } from "@/components/charts";
import { CopyButton } from "@/components/CopyButton";
import { EntriesTable } from "@/components/EntriesTable";
import { JobSummaries } from "@/components/JobSummaries";
import { MonthCalendar, type DayRoar } from "@/components/MonthCalendar";
import { MonthJobTable } from "@/components/MonthJobTable";
import { MonthNav } from "@/components/MonthNav";
import { PersistentDetails } from "@/components/PersistentDetails";
import { RoarPullButton } from "@/components/RoarPullButton";
import { BookedStat, PastWeeksStat, Stat, type StatView } from "@/components/StatCard";
import { dayShortfalls } from "@/lib/day-status";
import { listReporters, type EntryWithJob } from "@/lib/entries";
import { listEntryTypes } from "@/lib/entry-types";
import { FALLBACK_TYPE_COLOR, typeMapOf } from "@/lib/entry-types-shared";
import { formatDate, formatHours, round2 } from "@/lib/format";
import { getTicketCards } from "@/lib/jira/store";
import { currentMonth, formatMonth, resolveMonth } from "@/lib/month";
import { getMonthlyReport, getPastWeeksDue } from "@/lib/monthly";
import { NO_JOB_NUMBER } from "@/lib/projects-shared";
import { getJobReportSummaries, jobSummariesToText } from "@/lib/report";
import { roarInSync, roarPulledAt, roarStatusByEntry, type EntryRoarStatus } from "@/lib/roar-status";
import { getDayTargets } from "@/lib/schedule";
import { getUiOpen } from "@/lib/ui-state";
import { isoDate, todayIso } from "@/lib/week";

export const metadata: Metadata = { title: "Monthly report" };

export default async function MonthPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; by?: string }>;
}) {
  await connection();
  // A plugin's page: there while it's installed.
  if (!isInstalled("monthly-report")) return <PluginNotInstalled id="monthly-report" />;
  const sp = await searchParams;
  const requested = resolveMonth(sp.month);
  const month = requested ?? currentMonth();
  const by = sp.by?.trim() || undefined;
  const filtered = !!by;
  const today = todayIso();

  const report = getMonthlyReport(month, { reportedBy: by });
  const targets = getDayTargets(month.days);
  const target = round2(targets.reduce((a, t) => a + t.target, 0));
  const shortfalls = dayShortfalls(month, report.dayTotals, targets.map((t) => t.target), { today, filtered });

  // Per week of the month (its days only): the target, and the hours missing on past days.
  const dayIndex = new Map(month.days.map((d, i) => [isoDate(d), i]));
  const perWeek = (value: (i: number) => number) =>
    month.weeks.map((w) =>
      round2(
        w.days.reduce((a, d) => {
          const i = dayIndex.get(isoDate(d));
          return i === undefined ? a : a + value(i);
        }, 0),
      ),
    );
  const weekTargets = perWeek((i) => targets[i].target);
  const weekMissing = perWeek((i) => (shortfalls[i].state === "missing" ? shortfalls[i].gap : 0));

  // Roar approvals of the weeks pulled so far ("Pull Roar"): each day's approved hours.
  // (only with the Roar plugin installed)
  const roarOn = isInstalled("roar");
  const pulledAt = month.weeks.map((w) => (roarOn ? roarPulledAt(w) : null));
  const statuses: Record<number, EntryRoarStatus> = {};
  month.weeks.forEach((w, i) => {
    if (pulledAt[i]) Object.assign(statuses, roarStatusByEntry(w));
  });
  const roar: DayRoar[] = month.days.map((d) => {
    const iso = isoDate(d);
    const wi = month.weeks.findIndex((w) => iso >= w.startIso && iso <= w.endIso);
    if (!pulledAt[wi]) return null;
    const approved = report.entries.filter((e) => e.date === iso && statuses[e.id]?.kind === "approved");
    return { approved: round2(approved.reduce((a, e) => a + e.hours, 0)) };
  });
  // The oldest pull among the month's weeks (what "Roar status from …" vouches for).
  const oldestPull = pulledAt.filter((p): p is string => !!p).sort()[0] ?? null;

  const workdays = targets.filter((t) => t.target > 0).length;
  const absentDays = targets.filter((t) => t.absence).length;

  const types = listEntryTypes();
  const jobs = getJobReportSummaries(month.startIso, month.endIso, { reportedBy: by });
  const tickets = getTicketCards(jobs.flatMap((j) => j.lines.map((l) => l.ticket)));
  const reportLines = jobs.reduce((a, j) => a + j.lines.length, 0);
  const ui = await getUiOpen();
  const summaryText = jobSummariesToText(`${formatMonth(month)}${by ? ` · ${by}` : ""}`, report.total, jobs, formatHours);

  // Entry types in their configured order and colors; keys with hours but no type (deleted) in grey.
  const known = new Set(types.map((t) => t.key));
  const typeItems: BarItem[] = [
    ...types,
    ...Object.keys(report.byType)
      .filter((k) => !known.has(k))
      .map((k) => ({ key: k, label: k, color: FALLBACK_TYPE_COLOR, builtin: false })),
  ]
    .filter((t) => (report.byType[t.key] ?? 0) > 0)
    .sort((a, b) => (report.byType[b.key] ?? 0) - (report.byType[a.key] ?? 0))
    .map((t) => ({
      key: t.key,
      label: t.label,
      value: report.byType[t.key] ?? 0,
      valueLabel: `${formatHours(report.byType[t.key] ?? 0)} h`,
      color: t.color,
    }));
  const tagItems: BarItem[] = report.byTag.slice(0, 12).map((t) => ({
    key: String(t.tag.id),
    label: `#${t.tag.name}`,
    value: t.hours,
    valueLabel: `${formatHours(t.hours)} h`,
    barClass: "bg-teal-500",
  }));
  if (report.untaggedHours > 0) {
    tagItems.push({
      key: "untagged",
      label: "untagged",
      value: report.untaggedHours,
      valueLabel: `${formatHours(report.untaggedHours)} h`,
      barClass: "bg-zinc-300 dark:bg-zinc-600",
    });
  }

  return (
    <div className="page">
      <div className="page-aside">
        <MonthNav month={month} by={by} reporters={listReporters()} />
      </div>

      {sp.month && !requested && (
        <p className="alert-error">Could not read month &quot;{sp.month}&quot; — showing the current month instead.</p>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <BookedStat
          label="Booked this month"
          booked={report.total}
          target={target}
          workdays={workdays}
          absentDays={absentDays}
          filtered={filtered}
          days={month.days.map((d, i) => ({ shortfall: shortfalls[i], label: formatDate(d, { weekday: false }) }))}
          started={month.startIso <= today}
        />
        {/* Hours left unbooked in this month's weeks that are over. */}
        <PastWeeksStat due={getPastWeeksDue(month.startIso, month.endIso, today, { reportedBy: by })} />
        <Stat
          label="Entries"
          value={String(report.entries.length)}
          view={entriesView(report.entries, today > month.endIso)}
        />
      </div>

      <section className="card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-zinc-500 uppercase">Days</h2>
            <p className="text-xs text-zinc-400">booked hours{roarOn ? " and their Roar approval" : ""} · click a day to open its week</p>
          </div>
          {roarOn && <RoarPullButton month={month.key} pulledAt={oldestPull} synced={!!oldestPull && roarInSync(report.entries, statuses)} />}
        </div>
        <MonthCalendar
          month={month}
          dayTotals={report.dayTotals}
          roar={roar}
          roarOn={roarOn}
          targets={targets}
          shortfalls={shortfalls}
          today={today}
        />
      </section>

      <section className="card p-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-500 uppercase">Hours per job and week</h2>
        <MonthJobTable report={report} weekTargets={weekTargets} weekMissing={weekMissing} />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-4">
          <h2 className="mb-3 text-sm font-semibold text-zinc-500 uppercase">Hours by type</h2>
          <BarList items={typeItems} empty="No entries." />
        </section>
        <section className="card p-4">
          <h2 className="mb-3 text-sm font-semibold text-zinc-500 uppercase">Hours by tag</h2>
          <BarList items={tagItems} empty="No entries." />
        </section>
      </div>

      <section className="card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-zinc-500 uppercase">Report · {formatMonth(month)}</h2>
            <p className="text-xs text-zinc-400">
              What each job&apos;s time went to, named by your report rules{by ? ` · ${by}` : ""}
              {report.entries.length > 0 &&
                ` · ${report.entries.length} entr${report.entries.length === 1 ? "y" : "ies"} in ${reportLines} line${reportLines === 1 ? "" : "s"}`}
            </p>
          </div>
          {jobs.length > 0 && <CopyButton text={summaryText} label="Copy report" />}
        </div>
        <JobSummaries jobs={jobs} total={report.total} types={typeMapOf(types)} tickets={tickets} />
      </section>

      <section className="card p-4">
        <PersistentDetails name="month-entries" ui={ui} className="group">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-zinc-500 uppercase [&::-webkit-details-marker]:hidden">
            <span className="text-zinc-400 transition-transform group-open:rotate-90">▸</span>
            Entries in {formatMonth(month)}
            <span className="font-normal normal-case text-zinc-400">({report.entries.length})</span>
          </summary>
          <div className="mt-3">
            <EntriesTable entries={report.entries} roarStatuses={oldestPull ? statuses : undefined} />
          </div>
        </PersistentDetails>
      </section>
    </div>
  );
}

/** Entries: green when all have a job; entries still on "No job yet" are orange, red once the month is over. */
function entriesView(entries: EntryWithJob[], monthOver: boolean): StatView | undefined {
  if (entries.length === 0) return undefined;
  const noJob = entries.filter((e) => e.job.number === NO_JOB_NUMBER);
  if (noJob.length === 0) return { color: "green", icon: "check", caption: "All entries have a job" };
  const projectIds = [...new Set(noJob.flatMap((e) => (e.projectId == null ? [] : [e.projectId])))];
  const n = noJob.length;
  return {
    color: monthOver ? "red" : "orange",
    icon: monthOver ? "cross" : "info",
    caption: (
      <Link href={projectIds.length === 1 ? `/projects/${projectIds[0]}` : "/projects"} className="hover:underline">
        {n} {n === 1 ? "entry" : "entries"} without a job
      </Link>
    ),
  };
}
