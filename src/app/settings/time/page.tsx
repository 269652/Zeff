import Link from "next/link";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { isInstalled } from "@/plugins/state";
import type { Metadata } from "next";
import { t } from "@/lib/i18n/server";
import { rich } from "@/lib/i18n/rich";
import { connection } from "next/server";
import { deleteAbsenceAction } from "@/app/actions";
import { AbsenceForm } from "@/components/AbsenceForm";
import { DefaultPausesForm } from "@/components/DefaultPausesForm";
import { FlexTimeForm } from "@/components/FlexTimeForm";
import { MeetingExcludeRulesForm } from "@/components/MeetingExcludeRulesForm";
import { MeetingJobRulesForm } from "@/components/MeetingJobRulesForm";
import { ReportSettingsForm } from "@/components/ReportSettingsForm";
import { ScheduleForm } from "@/components/ScheduleForm";
import { SubmitButton } from "@/components/SubmitButton";
import { TypeRulesForm } from "@/components/TypeRulesForm";
import { WorkSettingsSection } from "@/components/work/WorkSettingsSection";
import { getTypeRules } from "@/lib/type-rules";
import { getMeetingDefaultJob, getMeetingExcludeRules, getMeetingJobRules, getReportRules, getReportSettings } from "@/lib/report";
import { getJobByNumber, listJobs } from "@/lib/jobs";
import { listProjects } from "@/lib/projects";
import { listMeetingTitles } from "@/lib/entries";
import { listEntryTypes } from "@/lib/entry-types";
import { listTags } from "@/lib/tags";
import { formatHours } from "@/lib/format";
import {
  absenceLabels,
  getFlexTime,
  getWorkSchedule,
  listAbsences,
  scheduleHours,
  type AbsenceType,
} from "@/lib/schedule";
import { todayIso } from "@/lib/week";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Time-tracking settings") };
}

/** Settings → Time tracking (/settings/time; was /settings — its old anchors lead here): hours, breaks, flex time, rules, absences, Code. */
export default async function TimeSettingsPage() {
  await connection();
  // Without time tracking: only the Work section (when that plugin's there).
  if (!isInstalled("zeiterfassung")) {
    return isInstalled("work") ? (
      <div className="page">
        <WorkSettingsSection />
      </div>
    ) : (
      <PluginNotInstalled id="zeiterfassung" />
    );
  }
  const schedule = getWorkSchedule();
  const hours = scheduleHours(schedule);
  const weekTotal = hours.reduce((a, b) => a + b, 0);
  const absences = listAbsences();
  const settings = getReportSettings();
  const reportRules = getReportRules(settings);
  const meetingJobRules = getMeetingJobRules(settings);
  const tagNames = listTags().map((tag) => tag.name);
  const jobOptions = listJobs().map((j) => ({ number: j.number, name: j.name }));
  const flex = getFlexTime(schedule);
  const sections: [string, string][] = [
    ["hours", t("Weekly hours")],
    ["breaks", t("Default break")],
    ["flex", t("Flex time")],
    ["types", t("Entry type rules")],
    ["report", t("Report rewriting")],
    ...(isInstalled("outlook-calendar") ? ([["meetings", t("Meetings")]] as [string, string][]) : []),
    ["absences", t("Absence")],
    ...(isInstalled("work") ? ([["work", t("Code")]] as [string, string][]) : []),
  ];
  // The flex-time job stays pickable even once it's deactivated.
  const flexJob = flex.jobNumber && !jobOptions.some((j) => j.number === flex.jobNumber) ? getJobByNumber(flex.jobNumber) : undefined;
  const flexJobOptions = flexJob ? [{ number: flexJob.number, name: t("{name} (inactive)", { name: flexJob.name }) }, ...jobOptions] : jobOptions;

  return (
    <div className="page">
      <div className="page-aside">
        <Link href="/settings" className="text-sm text-zinc-500 hover:underline">
          ← {t("Settings")}
        </Link>
        <h1 className="text-lg font-semibold">{t("Time-tracking settings")}</h1>
        <p className="text-sm text-zinc-500">
          {t("Set your weekly working pattern (part-time) and record time off. The weekly report uses this to show booked hours against your target.")}
        </p>
      </div>

      <nav aria-label={t("Sections of this page")} className="sticky top-0 z-10 -mx-1 flex flex-wrap gap-1 rounded-md border border-zinc-200 bg-white/90 p-1 text-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
        {sections.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="rounded px-2 py-1 text-zinc-600 hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 dark:text-zinc-300 dark:hover:bg-zinc-800">
            {label}
          </a>
        ))}
      </nav>

      <section id="hours" className="card scroll-mt-14 p-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-500 uppercase">{t("Weekly hours · {hours} h/week", { hours: formatHours(weekTotal) })}</h2>
        <ScheduleForm hours={hours} />
      </section>

      <section id="breaks" className="card scroll-mt-14 space-y-3 p-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Default break")}</h2>
          <p className="mt-1 text-sm text-zinc-500">
            {rich(
              t(
                "Your usual break window on workdays, e.g. <mono>12:00-13:00</mono> (several with “;”). The weekly table shows it greyed out on days without an entered break — click its + to take it for that day. Breaks you enter always go to Punch as Geht/Kommt.",
              ),
              { mono: (s) => <span className="font-mono">{s}</span> },
            )}
          </p>
        </div>
        <DefaultPausesForm text={schedule.defaultPauses ?? ""} exportToPunch={schedule.punchDefaultPauses} punchOn={isInstalled("punch")} />
      </section>

      <section id="flex" className="card scroll-mt-14 space-y-3 p-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Flex time")}</h2>
          <p className="mt-1 text-sm text-zinc-500">
            {rich(
              t(
                "The job for hours you take off your overtime. In the weekly table, days that aren't fully booked get a greyed-out row for it under the booked jobs — click a day's <mono>+</mono> to book its missing hours there with this comment. Punch doesn't get these hours as working time, so its own flex-time balance goes down.",
              ),
              { mono: (s) => <span className="font-mono">{s}</span> },
            )}
          </p>
        </div>
        <FlexTimeForm flex={flex} jobs={flexJobOptions} />
      </section>

      <section id="types" className="card scroll-mt-14 space-y-3 p-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Entry type rules")}</h2>
          <p className="mt-1 text-sm text-zinc-500">
            {t("Infer an entry's type (Ticket, Meeting, Internal, Other, Absence) from its job and description — e.g. job Abwesenheit + “Urlaub” → Absence. Report rules and exports can then key off the type.")}
          </p>
        </div>
        <TypeRulesForm initialRules={getTypeRules()} jobs={jobOptions} types={listEntryTypes()} />
      </section>

      <section id="report" className="card scroll-mt-14 space-y-3 p-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Report rewriting")}</h2>
          <p className="mt-1 text-sm text-zinc-500">
            {t("Rules that rewrite and group the “Report” view on the weekly page — a condition on each entry maps to an output label, and optionally to tags for those entries.")}
          </p>
        </div>
        <ReportSettingsForm
          types={listEntryTypes()}
          initialRules={reportRules}
          tags={tagNames}
          jobs={jobOptions}
          projects={listProjects({ includeInactive: true }).map((p) => p.title)}
          meetingTitles={listMeetingTitles()}
        />
      </section>

      {/* Meetings come from the Outlook calendar plugin: its rules only while it's installed. */}
      {isInstalled("outlook-calendar") && (
        <>
      <section id="meetings" className="card scroll-mt-14 space-y-3 p-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Meeting → job rules")}</h2>
          <p className="mt-1 text-sm text-zinc-500">
            {t("Auto-pick a job when importing meetings, by matching the meeting title — e.g. book every “Mob Programming” meeting on your Relaunch job.")}
          </p>
        </div>
        <MeetingJobRulesForm
          initialRules={meetingJobRules}
          initialDefaultJob={getMeetingDefaultJob(settings)}
          jobs={jobOptions}
        />
      </section>

      <section className="card space-y-3 p-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Meeting exclude rules")}</h2>
          <p className="mt-1 text-sm text-zinc-500">
            {t("Imported meetings whose title contains one of these start unticked — for placeholders and reminders like “Zeiten in Chrono Erfassen”.")}{" "}
            {rich(t("<b>Exclude</b> / <b>Include</b> next to a meeting on the import page adds or removes it here."), {
              b: (s) => <strong>{s}</strong>,
            })}
          </p>
        </div>
        <MeetingExcludeRulesForm initialRules={getMeetingExcludeRules(settings)} />
      </section>
        </>
      )}

      <section id="absences" className="card scroll-mt-14 space-y-4 p-4">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Absences & time off")}</h2>
        <AbsenceForm defaultDate={todayIso()} />

        {absences.length === 0 ? (
          <p className="py-2 text-center text-sm text-zinc-500">{t("No absences recorded.")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t("From")}</th>
                  <th scope="col">{t("To")}</th>
                  <th scope="col">{t("Type")}</th>
                  <th scope="col" className="num">{t("Hours/day")}</th>
                  <th scope="col">{t("Note")}</th>
                  <th scope="col"><span className="sr-only">{t("Actions")}</span></th>
                </tr>
              </thead>
              <tbody>
                {absences.map((a) => (
                  <tr key={a.id}>
                    <td className="font-mono whitespace-nowrap">{a.startDate}</td>
                    <td className="font-mono whitespace-nowrap">{a.endDate}</td>
                    <td>
                      <span className="badge badge-web">{absenceLabels(t)[a.type as AbsenceType]}</span>
                    </td>
                    <td className="num">{a.hours == null ? t("full day") : formatHours(a.hours)}</td>
                    <td>{a.note ?? ""}</td>
                    <td className="text-right">
                      <form action={deleteAbsenceAction}>
                        <input type="hidden" name="id" value={a.id} />
                        <SubmitButton className="btn btn-sm btn-danger" pendingText="…" confirm={t("Delete the absence {type} ({from} to {to})? Targets, Chrono and Punch change with it.", { type: absenceLabels(t)[a.type as AbsenceType], from: a.startDate, to: a.endDate })}>
                          {t("Delete")}
                        </SubmitButton>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {isInstalled("work") && <WorkSettingsSection />}
    </div>
  );
}
