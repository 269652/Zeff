import type { Metadata } from "next";
import { connection } from "next/server";
import { createEntryAction } from "@/app/actions";
import { EntriesTable } from "@/components/EntriesTable";
import { EntryForm } from "@/components/EntryForm";
import { WeekNav } from "@/components/WeekNav";
import { WeekTable } from "@/components/WeekTable";
import { getWeeklyReport, listReporters } from "@/lib/entries";
import { formatHours } from "@/lib/format";
import { listJobs } from "@/lib/jobs";
import { currentWeek, resolveWeek, todayIso } from "@/lib/week";

export const metadata: Metadata = { title: "Weekly report" };

export default async function WeekPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; by?: string }>;
}) {
  await connection();
  const sp = await searchParams;
  const requested = resolveWeek(sp.week);
  const week = requested ?? currentWeek();
  const by = sp.by?.trim() || undefined;

  const report = getWeeklyReport(week, { reportedBy: by });
  const jobs = listJobs();
  const reporters = listReporters();

  const today = todayIso();
  const defaultDate = today >= week.startIso && today <= week.endIso ? today : week.startIso;

  return (
    <div className="space-y-6">
      <WeekNav week={week} by={by} reporters={reporters} />

      {sp.week && !requested && (
        <p className="alert-error">
          Could not read week &quot;{sp.week}&quot; — showing the current week instead.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Hours this week" value={formatHours(report.total)} />
        <Stat label="Jobs worked on" value={String(report.rows.length)} />
        <Stat label="Entries" value={String(report.entries.length)} />
      </div>

      <section className="card p-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-500 uppercase">Hours per job and day</h2>
        <WeekTable report={report} />
      </section>

      <section className="card p-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-500 uppercase">Add entry</h2>
        <EntryForm jobs={jobs} action={createEntryAction} defaults={{ date: defaultDate }} />
      </section>

      <section className="card p-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-500 uppercase">
          Entries in week {week.week}
        </h2>
        <EntriesTable entries={report.entries} />
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-xs font-medium text-zinc-500 uppercase">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
