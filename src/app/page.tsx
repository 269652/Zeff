import { redirect } from "next/navigation";
import { firstAppTab } from "@/plugins/tabs";
import { installedPlugins, isInstalled } from "@/plugins/state";
import type { Metadata } from "next";
import { t } from "@/lib/i18n/server";
import Link from "next/link";
import { connection } from "next/server";
import { parseISO } from "date-fns";
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
import { WeekCloseCard } from "@/components/WeekCloseCard";
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
import { weekClose } from "@/lib/week-close";
import { getWeeklyReport, listReporters } from "@/lib/entries";
import { currentLocale, formatDate, formatHours, round2 } from "@/lib/format";
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

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Weekly report") };
}

export default async function WeekPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; by?: string; imported?: string; skipped?: string }>;
}) {
  await connection();
  // The weekly report is a plugin too: without it, home is the first installed application.
  // A new Zeff (or account): nothing here — the layout shows the way into the setup assistant.
  if (!(await import("@/lib/ai")).getAppSettings().setupDoneAt) return null;
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
  const allTags = listTags().map((tag) => tag.name);
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
  const bookedDays = week.days.map((d, i) => ({ shortfall: shortfall[i], label: d.toLocaleDateString(currentLocale(), { weekday: "short" }) }));
  const todayIndex = week.days.findIndex((d) => isoDate(d) === today);
  const todayBooked = todayIndex >= 0 ? { booked: report.dayTotals[todayIndex], target: targets.targets[todayIndex] } : undefined;

  return (
    <div className="page">
      <div className="page-aside">
        <WeekNav week={week} by={by} reporters={reporters} />
      </div>

      {sp.imported !== undefined && (
        <p className="alert-ok">
          {sp.imported === "1"
            ? sp.skipped
              ? t("Imported 1 meeting as time entries ({skipped} already booked, skipped).", { skipped: sp.skipped })
              : t("Imported 1 meeting as time entries.")
            : sp.skipped
              ? t("Imported {n} meetings as time entries ({skipped} already booked, skipped).", { n: sp.imported, skipped: sp.skipped })
              : t("Imported {n} meetings as time entries.", { n: sp.imported })}
        </p>
      )}

      {sp.week && !requested && (
        <p className="alert-error">{t('Could not read week "{week}" — showing the current week instead.', { week: sp.week })}</p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <BookedStat
          label={t("Booked this week")}
          booked={report.total}
          target={targets.weekTarget}
          workdays={targets.targets.filter((h) => h > 0).length}
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
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Hours per job and day")}</h2>
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
        <h2 className="mb-3 text-sm font-semibold text-zinc-500 uppercase">{t("Add entry")}</h2>
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

      {/* Closing the week: every step in one list (not with a reporter filter — that's part of the bookings only). */}
      {!by && <WeekCloseCard close={await weekClose(week)} week={week.week} />}

      <SuggestionsPanel items={openSuggestions()} />

      <DoneTodayPanel items={doneToday()} />

      <section className="card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Report · week {n}", { n: week.week })}</h2>
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-400">{t("grouped per day · configure on Schedule")}</span>
            {chronoOn && (
              <Link
                href={`/export/chrono?week=${week.key}${by ? `&by=${encodeURIComponent(by)}` : ""}`}
                className="btn btn-sm"
              >
                {t("Export to Chrono →")}
              </Link>
            )}
            {punchOn && (
              <Link
                href={`/export/punch?week=${week.key}${by ? `&by=${encodeURIComponent(by)}` : ""}`}
                className="btn btn-sm"
              >
                {t("Export to Punch →")}
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
            {t("Entries in week {n}", { n: week.week })}
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
  const day = (iso: string) => formatDate(iso);
  const item = (i: ChronoItem) => `${day(i.date)} · ${i.jobNumber} · ${formatHours(i.hours)} h “${i.comment}”`;
  const waitingHours = round2(a.awaiting.reduce((s, i) => s + i.hours, 0));
  const notSubmitted = a.unsubmitted.length ? t("{n} not submitted", { n: a.unsubmitted.length }) : "";

  const left: StatHalf = {
    label: t("Awaiting approval"),
    value: pulled ? String(a.awaiting.length) : "–",
    // The oldest waiting (else unsubmitted) entry's month: its calendar shows which days.
    href: a.awaiting[0] || a.unsubmitted[0] ? `/month?month=${(a.awaiting[0] ?? a.unsubmitted[0]).date.slice(0, 7)}` : undefined,
    title:
      [
        ...a.awaiting.map((i) => `${item(i)}${i.approver ? ` · ${t("waiting for {who}", { who: i.approver })}` : ""}`),
        ...a.unsubmitted.map((i) => `${item(i)} · ${t("not submitted")}`),
      ].join("\n") || undefined,
    view: !pulled
      ? undefined
      : a.awaiting.length
        ? { color: "amber", icon: "info", caption: [`${formatHours(waitingHours)} h`, notSubmitted].filter(Boolean).join(" · ") }
        : notSubmitted
          ? { color: "orange", icon: "info", caption: notSubmitted }
          : { color: "green", icon: "check", caption: t("Nothing waiting") },
    hint: pulled ? undefined : t("Pull Chrono to see approvals"),
  };
  const right: StatHalf = {
    label: t("Rejected"),
    value: pulled ? String(a.rejected.length) : "–",
    // The first rejected entry's week, where it gets corrected.
    href: a.rejected[0] ? `/?week=${weekFromDate(parseISO(a.rejected[0].date)).key}` : undefined,
    title: a.rejected.map((i) => `${item(i)}${i.rejectionComment ? ` — ${i.rejectionComment}` : ""}`).join("\n") || undefined,
    view: !pulled
      ? undefined
      : a.rejected.length
        ? { color: "red", icon: "cross", caption: [...new Set(a.rejected.map((i) => day(i.date)))].slice(0, 3).join(", ") }
        : { color: "green", icon: "check", caption: t("None rejected") },
  };
  return (
    <SplitStat
      className="sm:col-span-2"
      left={left}
      right={right}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-x-2">
          <span>
            {last.start.toLocaleDateString(currentLocale(), { month: "short" })} –{" "}
            {current.start.toLocaleDateString(currentLocale(), { month: "short", year: "numeric" })}
            {a.unpulledWeeks.length > 0 && ` · ${t("not pulled: {weeks}", { weeks: a.unpulledWeeks.map((k) => `W${Number(k.slice(-2))}`).join(", ") })}`}
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
