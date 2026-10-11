import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { isInstalled } from "@/plugins/state";
import type { Metadata } from "next";
import { t } from "@/lib/i18n/server";
import Link from "next/link";
import { connection } from "next/server";
import { CalendarWeek } from "@/components/CalendarWeek";
import { OutlookSyncButton } from "@/components/OutlookSyncButton";
import { inboxSyncedAt } from "@/lib/calendar/inbox";
import { getCalendarWeek } from "@/lib/calendar/week-view";
import { listBookedOnDates } from "@/lib/entries";
import { listJobs } from "@/lib/jobs";
import { getMeetingDefaultJob, getMeetingExcludeRules, getMeetingJobRules, getReportSettings } from "@/lib/report";
import { currentWeek, formatWeekRange, isoDate, resolveWeek, shiftWeek, todayIso } from "@/lib/week";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Calendar") };
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; imported?: string; skipped?: string }>;
}) {
  await connection();
  // A plugin's page: there while it's installed.
  if (!isInstalled("outlook-calendar")) return <PluginNotInstalled id="outlook-calendar" />;
  const sp = await searchParams;
  const requested = resolveWeek(sp.week);
  const week = requested ?? currentWeek();
  const settings = getReportSettings();
  const jobs = listJobs().map((j) => ({ number: j.number, name: j.name }));
  const other = getMeetingDefaultJob(settings);
  const defaultJob = (other && jobs.some((j) => j.number === other) ? other : jobs[0]?.number) ?? "";
  const days = getCalendarWeek(week, {
    now: new Date(),
    booked: listBookedOnDates(week.days.map(isoDate)),
    excludeRules: getMeetingExcludeRules(settings),
    jobRules: getMeetingJobRules(settings),
    defaultJob,
  });
  const syncedAt = inboxSyncedAt(week.startIso);
  const count = days.reduce((a, d) => a + d.events.length + d.allDay.length, 0);
  // The grid starts over (fresh ticks) after a sync or an import.
  const booked = days.reduce((a, d) => a + d.events.filter((e) => e.state === "booked").length, 0);
  const href = (w: string) => `/calendar?week=${w}`;

  return (
    <div className="page">
      <div className="page-aside">
        <div>
          <h1 className="text-lg font-semibold">{t("Calendar")}</h1>
          <p className="text-sm text-zinc-500">
            {t("Your Outlook meetings, synced from the automation Chrome. Tick the ones to book and import them — finished meetings that aren't booked yet start ticked.")}
          </p>
        </div>
        <OutlookSyncButton week={week.key} syncedAt={syncedAt} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Link className="btn" href={href(shiftWeek(week, -1).key)} aria-label={t("Previous week")}>
          ←
        </Link>
        <div className="min-w-44 text-center">
          <div className="font-semibold">
            {t("Week {n}", { n: week.week })} <span className="text-zinc-400">·</span> {week.year}
          </div>
          <div className="text-sm text-zinc-500">{formatWeekRange(week)}</div>
        </div>
        <Link className="btn" href={href(shiftWeek(week, 1).key)} aria-label={t("Next week")}>
          →
        </Link>
        {week.key !== currentWeek().key && (
          <Link className="btn btn-sm" href="/calendar">
            {t("This week")}
          </Link>
        )}
        <Link className="btn btn-sm ml-auto" href={`/?week=${week.key}`}>
          {t("Weekly report →")}
        </Link>
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
      {sp.week && !requested && <p className="alert-error">{t('Could not read week "{week}" — showing this week.', { week: sp.week })}</p>}

      <section className="card p-4">
        {count === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-500">
            {syncedAt ? t("No meetings in this week.") : t("This week hasn't been synced yet — click Sync Outlook.")}
          </p>
        ) : (
          <CalendarWeek key={`${week.key}:${syncedAt ?? ""}:${booked}`} weekKey={week.key} days={days} jobs={jobs} today={todayIso()} />
        )}
      </section>

      <p className="text-xs text-zinc-400">
        {t(
          "Sync reads Outlook on the web in the automation Chrome (sign in there once) — from the start of last month to next week, plus the week shown; nothing is changed in Outlook. Jobs come from your",
        )}{" "}
        <Link href="/settings" className="underline">
          {t("meeting → job rules")}
        </Link>
        {t(". Other ways to load meetings (bookmarklet, paste):")}{" "}
        <Link href={`/import?week=${week.key}`} className="underline">
          {t("Import meetings")}
        </Link>
        .
      </p>
    </div>
  );
}
