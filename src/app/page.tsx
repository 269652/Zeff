import { collectHeadsOn } from "@/lib/entry-parallel";
import { ParallelPanel } from "@/components/ParallelPanel";
import { redirect } from "@/lib/redirect";
import { firstAppTab } from "@/plugins/tabs";
import { isInstalled } from "@/plugins/state";
import type { Metadata } from "next";
import { t } from "@/lib/i18n/server";
import { Fragment } from "react";
import { connection } from "next/server";
import { createEntryAction } from "@/app/actions";
import { ContextFormOptionsProvider } from "@/components/ContextFormOptions";
import { EntriesTable } from "@/components/EntriesTable";
import { EntryForm } from "@/components/EntryForm";
import { PersistentDetails } from "@/components/PersistentDetails";
import { ReportView } from "@/components/ReportView";
import { BookedStat, PastWeeksStat } from "@/components/StatCard";
import { WeekNav } from "@/components/WeekNav";
import { ReportToggle } from "@/components/ReportToggle";
import { WeekCloseCard } from "@/components/WeekCloseCard";
import { WeekTable } from "@/components/WeekTable";
import { listContextPeople } from "@/lib/contexts";
import { dayShortfalls } from "@/lib/day-status";
import { listDefaultTagMaps } from "@/lib/default-tags";
import { listEntryTypes } from "@/lib/entry-types";
import { getTicketCards } from "@/lib/jira/store";
import { lastAndCurrentMonth } from "@/lib/month";
import { getPastWeeksDue } from "@/lib/monthly";
import { marksOf, weekSlots } from "@/lib/integrations/slots";
import { weekClose } from "@/lib/week-close";
import { getWeeklyReport, listReporters } from "@/lib/entries";
import { currentLocale, formatHours } from "@/lib/format";
import { getJobByNumber, listJobs } from "@/lib/jobs";
import { latestPausesBefore, listPausesByDate } from "@/lib/pauses";
import { listProjectOptions } from "@/lib/projects";
import { getRewrittenReport, reportToText } from "@/lib/report";
import { getEntryTicketSuggestions } from "@/lib/ticket-suggestions";
import { getDefaultPauses, getFlexTime, getWeekTargets } from "@/lib/schedule";
import { listTags } from "@/lib/tags";
import { getTypeRules } from "@/lib/type-rules";
import { getUiOpen } from "@/lib/ui-state";
import { currentWeek, isoDate, resolveWeek, todayIso } from "@/lib/week";
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
  // The time-sheet plugins (Chrono, Punch: mounted integrations): what they add to the week — only while they're installed.
  const slots = await weekSlots({ week, entries: report.entries, by });
  const marks = marksOf(slots);

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
        <ReportToggle view="week" />
        <WeekNav week={week} by={by} reporters={reporters} />
      </div>

      {sp.imported !== undefined && (
        <p role="status" className="alert-ok">
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
        <p role="alert" className="alert-error">{t('Could not read week "{week}" — showing the current week instead.', { week: sp.week })}</p>
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
        {slots.map((x) => (
          <Fragment key={x.id}>{x.slot.card}</Fragment>
        ))}
      </div>

      <section className="card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Hours per job and day")}</h2>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {[...slots].reverse().map((x) => (
              <Fragment key={x.id}>{x.slot.actions}</Fragment>
            ))}
          </div>
        </div>
        <WeekTable
          report={report}
          targets={targets}
          pauses={listPausesByDate(week.startIso, week.endIso)}
          lastPauses={latestPausesBefore(week.startIso)}
          defaultPauses={getDefaultPauses()}
          marks={marks}
          flex={flexRow()}
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
            groupDays={Object.fromEntries(week.days.flatMap((d) => { const g = collectHeadsOn(isoDate(d))[0]; return g ? [[isoDate(d), g.head.description]] : []; }))}
          />
        </ContextFormOptionsProvider>
      </section>

      {/* Closing the week: every step in one list (not with a reporter filter — that's part of the bookings only). */}
      {!by && <WeekCloseCard close={await weekClose(week)} week={week.week} />}

      <SuggestionsPanel items={openSuggestions()} />

      <DoneTodayPanel items={doneToday()} />

      {/* Two tasks of one job done at the same time, still booked on top of each other. */}
      <ParallelPanel from={week.startIso} to={week.endIso} />

      <section className="card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Report · week {n}", { n: week.week })}</h2>
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-400">{t("grouped per day · configure on Schedule")}</span>
            {slots.map((x) => (
              <Fragment key={x.id}>{x.slot.exports}</Fragment>
            ))}
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
            <EntriesTable entries={report.entries} marks={marks} />
          </div>
        </PersistentDetails>
      </section>
    </div>
  );
}

/** The flex-time job and comment for the weekly table's shadow row — when one is set (Schedule → Flex time). */
function flexRow() {
  const flex = getFlexTime();
  const job = flex.jobNumber ? getJobByNumber(flex.jobNumber) : undefined;
  return job ? { job: { id: job.id, number: job.number, name: job.name }, comment: flex.comment } : undefined;
}
