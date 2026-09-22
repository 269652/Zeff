import type { Metadata } from "next";
import { connection } from "next/server";
import { deleteAbsenceAction } from "@/app/actions";
import { AbsenceForm } from "@/components/AbsenceForm";
import { ReportSettingsForm } from "@/components/ReportSettingsForm";
import { ScheduleForm } from "@/components/ScheduleForm";
import { SubmitButton } from "@/components/SubmitButton";
import { getReportRules, getReportSettings } from "@/lib/report";
import { listJobs } from "@/lib/jobs";
import { listTags } from "@/lib/tags";
import { formatHours } from "@/lib/format";
import {
  ABSENCE_LABELS,
  getWorkSchedule,
  listAbsences,
  scheduleHours,
  type AbsenceType,
} from "@/lib/schedule";
import { todayIso } from "@/lib/week";

export const metadata: Metadata = { title: "Working hours & absences" };

export default async function SettingsPage() {
  await connection();
  const schedule = getWorkSchedule();
  const hours = scheduleHours(schedule);
  const weekTotal = hours.reduce((a, b) => a + b, 0);
  const absences = listAbsences();
  const reportRules = getReportRules(getReportSettings());
  const tagNames = listTags().map((t) => t.name);
  const jobOptions = listJobs().map((j) => ({ number: j.number, name: j.name }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Working hours &amp; absences</h1>
        <p className="text-sm text-zinc-500">
          Set your weekly working pattern (part-time) and record time off. The weekly report uses this
          to show booked hours against your target.
        </p>
      </div>

      <section className="card p-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-500 uppercase">
          Weekly hours · {formatHours(weekTotal)} h/week
        </h2>
        <ScheduleForm hours={hours} />
      </section>

      <section className="card space-y-3 p-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">Report rewriting</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Rules that rewrite and group the “Report” view on the weekly page — a condition on each
            entry maps to an output label.
          </p>
        </div>
        <ReportSettingsForm initialRules={reportRules} tags={tagNames} jobs={jobOptions} />
      </section>

      <section className="card space-y-4 p-4">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase">Absences &amp; time off</h2>
        <AbsenceForm defaultDate={todayIso()} />

        {absences.length === 0 ? (
          <p className="py-2 text-center text-sm text-zinc-500">No absences recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>From</th>
                  <th>To</th>
                  <th>Type</th>
                  <th className="num">Hours/day</th>
                  <th>Note</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {absences.map((a) => (
                  <tr key={a.id}>
                    <td className="font-mono whitespace-nowrap">{a.startDate}</td>
                    <td className="font-mono whitespace-nowrap">{a.endDate}</td>
                    <td>
                      <span className="badge badge-web">{ABSENCE_LABELS[a.type as AbsenceType]}</span>
                    </td>
                    <td className="num">{a.hours == null ? "full day" : formatHours(a.hours)}</td>
                    <td>{a.note ?? ""}</td>
                    <td className="text-right">
                      <form action={deleteAbsenceAction}>
                        <input type="hidden" name="id" value={a.id} />
                        <SubmitButton className="btn btn-sm btn-danger" pendingText="…">Delete</SubmitButton>
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
