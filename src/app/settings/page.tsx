import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { isInstalled } from "@/plugins/state";
import type { Metadata } from "next";
import { t } from "@/lib/i18n/server";
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
  return { title: t("Working hours & absences") };
}

export default async function SettingsPage() {
  await connection();
  if (!isInstalled("zeiterfassung")) return <PluginNotInstalled id="zeiterfassung" />;
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
  // The flex-time job stays pickable even once it's deactivated.
  const flexJob = flex.jobNumber && !jobOptions.some((j) => j.number === flex.jobNumber) ? getJobByNumber(flex.jobNumber) : undefined;
  const flexJobOptions = flexJob ? [{ number: flexJob.number, name: t("{name} (inactive)", { name: flexJob.name }) }, ...jobOptions] : jobOptions;

  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">{t("Working hours & absences")}</h1>
        <p className="text-sm text-zinc-500">
          {t("Set your weekly working pattern (part-time) and record time off. The weekly report uses this to show booked hours against your target.")}
        </p>
      </div>

      <section className="card p-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-500 uppercase">{t("Weekly hours · {hours} h/week", { hours: formatHours(weekTotal) })}</h2>
        <ScheduleForm hours={hours} />
      </section>

      <section className="card space-y-3 p-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Default break")}</h2>
          <p className="mt-1 text-sm text-zinc-500">
            {t("Your usual break window on workdays, e.g.")} <span className="font-mono">12:00-13:00</span>{" "}
            {t("(several with “;”). The weekly table shows it greyed out on days without an entered break — click its + to take it for that day. Breaks you enter always go to Punch as Geht/Kommt.")}
          </p>
        </div>
        <DefaultPausesForm text={schedule.defaultPauses ?? ""} exportToPunch={schedule.punchDefaultPauses} punchOn={isInstalled("punch")} />
      </section>

      <section className="card space-y-3 p-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Flex time (Gleitzeit)")}</h2>
          <p className="mt-1 text-sm text-zinc-500">
            {t("The job for hours you take off your overtime. In the weekly table, days that aren't fully booked get a greyed-out row for it under the booked jobs — click a day's")}{" "}
            <span className="font-mono">+</span>{" "}
            {t("to book its missing hours there with this comment. Punch doesn't get these hours as working time, so its own flex-time balance goes down.")}
          </p>
        </div>
        <FlexTimeForm flex={flex} jobs={flexJobOptions} />
      </section>

      <section className="card space-y-3 p-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Entry type rules")}</h2>
          <p className="mt-1 text-sm text-zinc-500">
            {t("Infer an entry's type (Ticket, Meeting, Internal, Other, Absence) from its job and description — e.g. job Abwesenheit + “Urlaub” → Absence. Report rules and exports can then key off the type.")}
          </p>
        </div>
        <TypeRulesForm initialRules={getTypeRules()} jobs={jobOptions} types={listEntryTypes()} />
      </section>

      <section className="card space-y-3 p-4">
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
      <section className="card space-y-3 p-4">
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
            <strong>{t("Exclude")}</strong> / <strong>{t("Include")}</strong> {t("next to a meeting on the import page adds or removes it here.")}
          </p>
        </div>
        <MeetingExcludeRulesForm initialRules={getMeetingExcludeRules(settings)} />
      </section>
        </>
      )}

      <section className="card space-y-4 p-4">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Absences & time off")}</h2>
        <AbsenceForm defaultDate={todayIso()} />

        {absences.length === 0 ? (
          <p className="py-2 text-center text-sm text-zinc-500">{t("No absences recorded.")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("From")}</th>
                  <th>{t("To")}</th>
                  <th>{t("Type")}</th>
                  <th className="num">{t("Hours/day")}</th>
                  <th>{t("Note")}</th>
                  <th></th>
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
                        <SubmitButton className="btn btn-sm btn-danger" pendingText="…">
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
    </div>
  );
}
