import type { Metadata } from "next";
import { connection } from "next/server";
import { createEntryAction } from "@/app/actions";
import { EntriesTable } from "@/components/EntriesTable";
import { EntryForm } from "@/components/EntryForm";
import { ReportView } from "@/components/ReportView";
import { WeekNav } from "@/components/WeekNav";
import { WeekTable } from "@/components/WeekTable";
import { getWeeklyReport, listReporters } from "@/lib/entries";
import { formatHours, round2 } from "@/lib/format";
import { listJobs } from "@/lib/jobs";
import { getRewrittenReport, reportToText } from "@/lib/report";
import { getEntryTicketSuggestions } from "@/lib/ticket-suggestions";
import { getWeekTargets } from "@/lib/schedule";
import { listTags } from "@/lib/tags";
import { currentWeek, resolveWeek, todayIso } from "@/lib/week";

export const metadata: Metadata = { title: "Weekly report" };

export default async function WeekPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; by?: string; imported?: string; skipped?: string }>;
}) {
  await connection();
  const sp = await searchParams;
  const requested = resolveWeek(sp.week);
  const week = requested ?? currentWeek();
  const by = sp.by?.trim() || undefined;

  const report = getWeeklyReport(week, { reportedBy: by });
  const targets = getWeekTargets(week);
  const remaining = round2(targets.weekTarget - report.total);
  const rewritten = getRewrittenReport(week, { reportedBy: by });
  const reportText = reportToText(rewritten, formatHours);
  const jobs = listJobs();
  const reporters = listReporters();
  const allTags = listTags().map((t) => t.name);
  const ticketSuggestions = getEntryTicketSuggestions(week);

  const today = todayIso();
  const defaultDate = today >= week.startIso && today <= week.endIso ? today : week.startIso;

  return (
    <div className="space-y-6">
      <WeekNav week={week} by={by} reporters={reporters} />

      {sp.imported !== undefined && (
        <p className="alert-ok">
          Imported {sp.imported} meeting{sp.imported === "1" ? "" : "s"} as time entries
          {sp.skipped ? ` (${sp.skipped} already booked, skipped)` : ""}.
        </p>
      )}

      {sp.week && !requested && (
        <p className="alert-error">
          Could not read week &quot;{sp.week}&quot; — showing the current week instead.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Booked this week" value={`${formatHours(report.total)} h`} />
        <Stat label="Target" value={`${formatHours(targets.weekTarget)} h`} />
        <Stat
          label={remaining >= 0 ? "Remaining" : "Overtime"}
          value={`${remaining >= 0 ? "" : "+"}${formatHours(Math.abs(remaining))} h`}
          tone={remaining < 0 ? "over" : remaining === 0 ? "done" : "default"}
        />
        <Stat label="Entries" value={String(report.entries.length)} />
      </div>

      <section className="card p-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-500 uppercase">Hours per job and day</h2>
        <WeekTable report={report} targets={targets} />
      </section>

      <section className="card p-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-500 uppercase">Add entry</h2>
        <EntryForm
          jobs={jobs}
          action={createEntryAction}
          defaults={{ date: defaultDate }}
          allTags={allTags}
          ticketSuggestions={ticketSuggestions}
        />
      </section>

      <section className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">Report · week {week.week}</h2>
          <span className="text-xs text-zinc-400">grouped per day · configure on Schedule</span>
        </div>
        <ReportView report={rewritten} text={reportText} today={today} />
      </section>

      <section className="card p-4">
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-zinc-500 uppercase [&::-webkit-details-marker]:hidden">
            <span className="text-zinc-400 transition-transform group-open:rotate-90">▸</span>
            Entries in week {week.week}
            <span className="font-normal normal-case text-zinc-400">({report.entries.length})</span>
          </summary>
          <div className="mt-3">
            <EntriesTable entries={report.entries} />
          </div>
        </details>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "over" | "done";
}) {
  const valueClass =
    tone === "over"
      ? "text-amber-600 dark:text-amber-400"
      : tone === "done"
        ? "text-emerald-600 dark:text-emerald-400"
        : "";
  return (
    <div className="card px-4 py-3">
      <div className="text-xs font-medium text-zinc-500 uppercase">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums ${valueClass}`}>{value}</div>
    </div>
  );
}
