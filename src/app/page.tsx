import { redirect } from "next/navigation";
import { firstAppTab } from "@/plugins/tabs";
import { installedPlugins, isInstalled } from "@/plugins/state";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { format, parseISO } from "date-fns";
import { createEntryAction } from "@/app/actions";
import { ContextFormOptionsProvider } from "@/components/ContextFormOptions";
import { EntriesTable } from "@/components/EntriesTable";
import { EntryForm } from "@/components/EntryForm";
import { PersistentDetails } from "@/components/PersistentDetails";
import { ReportView } from "@/components/ReportView";
import { ChronoPullButton } from "@/components/ChronoPullButton";
import { PunchPullButton } from "@/components/PunchPullButton";
import { BookedStat, PastWeeksStat, SplitStat, type StatHalf } from "@/components/StatCard";
import { WeekNav } from "@/components/WeekNav";
import { WeekTable } from "@/components/WeekTable";
import { listContextPeople } from "@/lib/contexts";
import { dayShortfalls } from "@/lib/day-status";
import { listDefaultTagMaps } from "@/lib/default-tags";
import { listEntryTypes } from "@/lib/entry-types";
import { getTicketCards } from "@/lib/jira/store";
import { lastAndCurrentMonth } from "@/lib/month";
import { getPastWeeksDue } from "@/lib/monthly";
import {
  APPROVALS_FRESH_HOURS,
  getChronoApprovalSummary,
  pulledWithin,
  chronoInSync,
  chronoPulledAt,
  chronoStatusByEntry,
  type ChronoItem,
} from "@/lib/chrono-status";
import { punchDayStates } from "@/lib/punch-status";
import { getWeeklyReport, listReporters } from "@/lib/entries";
import { formatHours, round2 } from "@/lib/format";
import { getJobByNumber, listJobs } from "@/lib/jobs";
import { latestPausesBefore, listPausesByDate } from "@/lib/pauses";
import { listProjectOptions } from "@/lib/projects";
import { getRewrittenReport, reportToText } from "@/lib/report";
import { getEntryTicketSuggestions } from "@/lib/ticket-suggestions";
import { getDefaultPauses, getFlexTime, getWeekTargets } from "@/lib/schedule";
import { listTags } from "@/lib/tags";
import { getTypeRules } from "@/lib/type-rules";
import { getUiOpen } from "@/lib/ui-state";
import { currentWeek, isoDate, resolveWeek, todayIso, weekFromDate } from "@/lib/week";
import { doneToday } from "@/lib/work/booking";
import { DoneTodayPanel } from "@/components/DoneTodayPanel";
import { SuggestionsPanel } from "@/components/SuggestionsPanel";
import { openSuggestions } from "@/lib/work/suggestions";

export const metadata: Metadata = { title: "Weekly report" };

export default async function WeekPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; by?: string; imported?: string; skipped?: string }>;
}) {
  await connection();
  // The weekly report is a plugin too: without it, home is the first installed application.
  // A new Zeff (or account): the setup assistant first.
  if (!(await import("@/lib/ai")).getAppSettings().setupDoneAt) redirect("/setup");
  if (!isInstalled("weekly-report")) redirect(firstAppTab());
  const sp = await searchParams;
  const requested = resolveWeek(sp.week);
  const week = requested ?? currentWeek();
  const by = sp.by?.trim() || undefined;

  const report = getWeeklyReport(week, { reportedBy: by });
  const targets = getWeekTargets(week);
  const rewritten = getRewrittenReport(week, { reportedBy: by });
  const reportText = reportToText(rewritten, formatHours);
  const jobs = listJobs();
  const projects = listProjectOptions();
  const reporters = listReporters();
  const allTags = listTags().map((t) => t.name);
  const ticketSuggestions = getEntryTicketSuggestions(week);
  const ui = await getUiOpen();
  const types = listEntryTypes();
  // The time-sheet plugins: what they show only while they're installed.
  const plugins = installedPlugins();
  const chronoOn = plugins.has("chrono");
  const punchOn = plugins.has("punch");
  // Chrono approval statuses, once this week was pulled ("Pull Chrono").
  const pulledAt = chronoOn ? chronoPulledAt(week) : null;
  const chronoStatuses = pulledAt ? chronoStatusByEntry(week) : undefined;
  // What Punch has on the week's days, as last read ("Pull Punch", or after an export).
  const punch = punchOn ? punchDayStates(week) : null;

  const today = todayIso();
  const defaultDate = today >= week.startIso && today <= week.endIso ? today : week.startIso;
  const filtered = !!by;
  // The booked card: each day against its target (its color), and today's hours when this week holds today.
  const shortfall = dayShortfalls(week, report.dayTotals, targets.targets, { today, filtered });
  const bookedDays = week.days.map((d, i) => ({ shortfall: shortfall[i], label: format(d, "EEE") }));
  const todayIndex = week.days.findIndex((d) => isoDate(d) === today);
  const todayBooked = todayIndex >= 0 ? { booked: report.dayTotals[todayIndex], target: targets.targets[todayIndex] } : undefined;

  return (
    <div className="page">
      <div className="page-aside">
        <WeekNav week={week} by={by} reporters={reporters} />
      </div>

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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <BookedStat
          label="Booked this week"
          booked={report.total}
          target={targets.weekTarget}
          workdays={targets.targets.filter((t) => t > 0).length}
          absentDays={targets.absenceByDay.filter(Boolean).length}
          filtered={filtered}
          today={todayBooked}
          days={bookedDays}
          started={week.startIso <= today}
        />
        {/* Hours left unbooked in the weeks before this one, since the start of last month. */}
        <PastWeeksStat due={getPastWeeksDue(lastAndCurrentMonth().last.startIso, today, today, { reportedBy: by })} />
        {chronoOn && <ApprovalsCard />}
      </div>

      <section className="card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">Hours per job and day</h2>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {punch && <PunchPullButton week={week.key} pulledAt={punch.pulledAt} synced={punch.inSync} />}
            {chronoOn && <ChronoPullButton week={week.key} pulledAt={pulledAt} synced={chronoInSync(report.entries, chronoStatuses)} />}
          </div>
        </div>
        <WeekTable
          report={report}
          targets={targets}
          pauses={listPausesByDate(week.startIso, week.endIso)}
          lastPauses={latestPausesBefore(week.startIso)}
          defaultPauses={getDefaultPauses()}
          chronoStatuses={chronoStatuses}
          flex={flexRow()}
          punch={punch?.states}
        />
      </section>

      <section className="card p-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-500 uppercase">Add entry</h2>
        <ContextFormOptionsProvider value={{ people: listContextPeople(), tickets: ticketSuggestions }}>
          <EntryForm
            jobs={jobs}
            projects={projects}
            action={createEntryAction}
            defaults={{ date: defaultDate }}
            allTags={allTags}
            ticketSuggestions={ticketSuggestions}
            typeRules={getTypeRules()}
            defaultTagMaps={listDefaultTagMaps()}
            types={types}
            withContext
          />
        </ContextFormOptionsProvider>
      </section>

      <SuggestionsPanel items={openSuggestions()} />

      <DoneTodayPanel items={doneToday()} />

      <section className="card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">Report · week {week.week}</h2>
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-400">grouped per day · configure on Schedule</span>
            {chronoOn && (
              <Link
                href={`/export/chrono?week=${week.key}${by ? `&by=${encodeURIComponent(by)}` : ""}`}
                className="btn btn-sm"
              >
                Export to Chrono →
              </Link>
            )}
            {punchOn && (
              <Link
                href={`/export/punch?week=${week.key}${by ? `&by=${encodeURIComponent(by)}` : ""}`}
                className="btn btn-sm"
              >
                Export to Punch →
              </Link>
            )}
          </div>
        </div>
        <ReportView
          key={week.key}
          report={rewritten}
          text={reportText}
          today={today}
          ui={ui}
          types={types}
          ticketCards={getTicketCards(rewritten.days.flatMap((d) => d.lines.flatMap((l) => l.entries.map((e) => e.ticket))))}
        />
      </section>

      <section className="card p-4">
        <PersistentDetails name="week-entries" ui={ui} className="group">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-zinc-500 uppercase [&::-webkit-details-marker]:hidden">
            <span className="text-zinc-400 transition-transform group-open:rotate-90">▸</span>
            Entries in week {week.week}
            <span className="font-normal normal-case text-zinc-400">({report.entries.length})</span>
          </summary>
          <div className="mt-3">
            <EntriesTable entries={report.entries} chronoStatuses={chronoStatuses} />
          </div>
        </PersistentDetails>
      </section>
    </div>
  );
}

/**
 * Chrono approvals over the last full and the current month, from the weeks pulled so far:
 * "X awaiting approval" (amber; orange when some weren't even submitted) and "N rejected"
 * (red) — green when there are none. Hover a number for the entries behind it.
 */
function ApprovalsCard() {
  const { last, current } = lastAndCurrentMonth();
  const today = todayIso();
  const a = getChronoApprovalSummary(last.startIso, current.endIso, today);
  const pulled = a.pulledAt !== null;
  const day = (iso: string) => format(parseISO(iso), "EEE d.M.");
  const item = (i: ChronoItem) => `${day(i.date)} · ${i.jobNumber} · ${formatHours(i.hours)} h “${i.comment}”`;
  const waitingHours = round2(a.awaiting.reduce((s, i) => s + i.hours, 0));
  const notSubmitted = a.unsubmitted.length ? `${a.unsubmitted.length} not submitted` : "";

  const left: StatHalf = {
    label: "Awaiting approval",
    value: pulled ? String(a.awaiting.length) : "–",
    // The oldest waiting (else unsubmitted) entry's month: its calendar shows which days.
    href: a.awaiting[0] || a.unsubmitted[0] ? `/month?month=${(a.awaiting[0] ?? a.unsubmitted[0]).date.slice(0, 7)}` : undefined,
    title:
      [
        ...a.awaiting.map((i) => `${item(i)}${i.approver ? ` · waiting for ${i.approver}` : ""}`),
        ...a.unsubmitted.map((i) => `${item(i)} · not submitted`),
      ].join("\n") || undefined,
    view: !pulled
      ? undefined
      : a.awaiting.length
        ? { color: "amber", icon: "info", caption: [`${formatHours(waitingHours)} h`, notSubmitted].filter(Boolean).join(" · ") }
        : notSubmitted
          ? { color: "orange", icon: "info", caption: notSubmitted }
          : { color: "green", icon: "check", caption: "Nothing waiting" },
    hint: pulled ? undefined : "Pull Chrono to see approvals",
  };
  const right: StatHalf = {
    label: "Rejected",
    value: pulled ? String(a.rejected.length) : "–",
    // The first rejected entry's week, where it gets corrected.
    href: a.rejected[0] ? `/?week=${weekFromDate(parseISO(a.rejected[0].date)).key}` : undefined,
    title: a.rejected.map((i) => `${item(i)}${i.rejectionComment ? ` — ${i.rejectionComment}` : ""}`).join("\n") || undefined,
    view: !pulled
      ? undefined
      : a.rejected.length
        ? { color: "red", icon: "cross", caption: [...new Set(a.rejected.map((i) => day(i.date)))].slice(0, 3).join(", ") }
        : { color: "green", icon: "check", caption: "None rejected" },
  };
  return (
    <SplitStat
      className="sm:col-span-2"
      left={left}
      right={right}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-x-2">
          <span>
            {format(last.start, "MMM")} – {format(current.start, "MMM yyyy")}
            {a.unpulledWeeks.length > 0 && ` · not pulled: ${a.unpulledWeeks.map((k) => `W${Number(k.slice(-2))}`).join(", ")}`}
          </span>
          {/* ✓ for a few hours after a pull of every week. */}
          <ChronoPullButton approvals pulledAt={a.pulledAt} synced={a.unpulledWeeks.length === 0 && pulledWithin(a.pulledAt, APPROVALS_FRESH_HOURS)} />
        </div>
      }
    />
  );
}

/** The flex-time job and comment for the weekly table's shadow row — when one is set (Schedule → Flex time). */
function flexRow() {
  const flex = getFlexTime();
  const job = flex.jobNumber ? getJobByNumber(flex.jobNumber) : undefined;
  return job ? { job: { id: job.id, number: job.number, name: job.name }, comment: flex.comment } : undefined;
}
