"use client";

import { EmptyState } from "@/components/EmptyState";
import { useState, useTransition } from "react";
import { importMeetingsAction } from "@/plugins/outlook-calendar/server-actions";
import { setMeetingExcludedAction } from "@/app/actions";
import type { ActionState } from "@/app/action-helpers";
import { isExcludedMeeting, jobForMeeting, type Meeting, type MeetingFlag, type MeetingJobRule } from "@/lib/calendar/meetings";
import type { EntryFormJob } from "./EntryForm";
import { useT } from "@/components/I18nProvider";
import type { T } from "@/lib/i18n/shared";

type Row = Meeting & { jobNumber: string; description: string; ticketValue: string; hoursValue: string };

const flagLabels = (t: T): Record<MeetingFlag, string> => ({
  imported: t("already booked"),
  excluded: t("excluded"),
  tentative: t("tentative"),
  free: t("shown as free"),
  private: t("private"),
});

export function MeetingImportForm({
  weekKey,
  meetings,
  jobs,
  jobRules = [],
  otherMeetingsJob,
  defaultReportedBy,
}: {
  weekKey: string;
  meetings: Meeting[];
  jobs: EntryFormJob[];
  jobRules?: MeetingJobRule[];
  /** Job for meetings no rule matches (settings: "All other meetings"); null = the first job. */
  otherMeetingsJob?: string | null;
  defaultReportedBy: string;
}) {
  const t = useT();
  const fallbackJob =
    (otherMeetingsJob && jobs.some((j) => j.number === otherMeetingsJob) ? otherMeetingsJob : jobs[0]?.number) ?? "";
  const [defaultJob, setDefaultJob] = useState(fallbackJob);
  const [rows, setRows] = useState<Row[]>(() =>
    meetings.map((m) => ({
      ...m,
      // A matching meeting→job rule pre-selects the job; otherwise the "All other meetings" job.
      jobNumber: jobForMeeting(m.subject, jobRules) ?? fallbackJob,
      description: m.subject,
      ticketValue: m.ticket ?? "",
      hoursValue: String(m.hours),
    })),
  );
  const [state, setState] = useState<ActionState>(null);
  const [pending, startTransition] = useTransition();
  const [ruling, startRuling] = useTransition();

  /** Exclude / Include a meeting by title: save the rule, then re-check every row against the new rules. */
  function toggleExcluded(subject: string, exclude: boolean) {
    startRuling(async () => {
      const r = await setMeetingExcludedAction(subject, exclude);
      if (!r.ok || !r.rules) {
        setState({ ok: false, error: r.error ?? t("Could not save the exclude rule.") });
        return;
      }
      const rules = r.rules;
      setRows((rs) =>
        rs.map((row) => {
          const was = row.flags.includes("excluded");
          const now = isExcludedMeeting(row.subject, rules);
          if (was === now) return row;
          const flags: MeetingFlag[] = now ? [...row.flags, "excluded"] : row.flags.filter((f) => f !== "excluded");
          // Excluding unchecks; including restores the default tick (unless another flag says otherwise).
          return { ...row, flags, selected: now ? false : flags.length === 0 };
        }),
      );
    });
  }

  const update = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const setAll = (selected: boolean) =>
    setRows((rs) => rs.map((r) => ({ ...r, selected: selected && !r.flags.includes("imported") })));
  const applyJobToAll = (jobNumber: string) => {
    setDefaultJob(jobNumber);
    setRows((rs) => rs.map((r) => ({ ...r, jobNumber })));
  };

  const selectedRows = rows.filter((r) => r.selected);
  const selectedHours = selectedRows.reduce((a, r) => a + (Number(r.hoursValue) || 0), 0);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await importMeetingsAction(null, fd);
      setState(result ?? null);
    });
  }

  if (jobs.length === 0) {
    return <p className="text-sm text-zinc-500">{t("Create a job first — meetings are booked on a job number.")}</p>;
  }
  if (rows.length === 0) {
    return <EmptyState variant="centered">{t("No finished meetings to import in this week.")}</EmptyState>;
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <input type="hidden" name="rowCount" value={rows.length} />
      <input type="hidden" name="week" value={weekKey} />

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-64">
          <label className="label" htmlFor="defaultJob">{t("Book all meetings on")}</label>
          <select id="defaultJob" className="input" value={defaultJob} onChange={(e) => applyJobToAll(e.target.value)}>
            {jobs.map((j) => (
              <option key={j.id} value={j.number}>{j.number} — {j.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="reportedBy">{t("Reported by")}</label>
          <input id="reportedBy" name="reportedBy" className="input" defaultValue={defaultReportedBy} placeholder={t("your name")} />
        </div>
        <div className="flex gap-1 pb-0.5">
          <button type="button" className="btn btn-sm" onClick={() => setAll(true)}>{t("Select all")}</button>
          <button type="button" className="btn btn-sm" onClick={() => setAll(false)}>{t("None")}</button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th></th>
              <th>{t("Date")}</th>
              <th>{t("Time")}</th>
              <th>{t("Meeting → description")}</th>
              <th className="num">{t("Hours")}</th>
              <th>{t("Ticket")}</th>
              <th>{t("Job")}</th>
              <th>{t("Notes")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const imported = r.flags.includes("imported");
              const excluded = r.flags.includes("excluded");
              return (
                <tr key={r.externalId} className={r.selected ? "" : "text-zinc-400"}>
                  <td>
                    <input type="hidden" name={`externalId-${i}`} value={r.externalId} />
                    <input type="hidden" name={`date-${i}`} value={r.date} />
                    <input
                      type="checkbox"
                      name={`include-${i}`}
                      checked={r.selected}
                      disabled={imported}
                      onChange={(e) => update(i, { selected: e.target.checked })}
                      className="size-4 accent-indigo-600"
                    />
                  </td>
                  <td className="font-mono whitespace-nowrap">{r.date}</td>
                  <td className="font-mono whitespace-nowrap">{r.startTime}–{r.endTime}</td>
                  <td className="min-w-64">
                    <input name={`description-${i}`} className="input" value={r.description} onChange={(e) => update(i, { description: e.target.value })} disabled={imported} />
                    {r.organizer && <div className="mt-0.5 text-xs text-zinc-500">{t("by {name}", { name: r.organizer })}</div>}
                  </td>
                  <td>
                    <input name={`hours-${i}`} type="number" step="0.25" min="0.25" max="24" className="input num w-20" value={r.hoursValue} onChange={(e) => update(i, { hoursValue: e.target.value })} disabled={imported} />
                    <div className="mt-0.5 text-right text-xs text-zinc-500">{t("{n} min", { n: r.minutes })}</div>
                  </td>
                  <td>
                    <input name={`ticket-${i}`} className="input w-28 font-mono" value={r.ticketValue} onChange={(e) => update(i, { ticketValue: e.target.value })} disabled={imported} placeholder="—" />
                  </td>
                  <td>
                    <select name={`job-${i}`} className="input min-w-44" value={r.jobNumber} onChange={(e) => update(i, { jobNumber: e.target.value })} disabled={imported}>
                      {jobs.map((j) => (
                        <option key={j.id} value={j.number}>{j.number} — {j.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="whitespace-nowrap">
                    <div className="flex flex-wrap items-center gap-1">
                      {r.isTeams && <span className="badge badge-mcp">Teams</span>}
                      {r.flags.map((f) => (
                        <span key={f} className="badge badge-web">{flagLabels(t)[f]}</span>
                      ))}
                      {!imported && (
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={ruling}
                          onClick={() => toggleExcluded(r.subject, !excluded)}
                          title={
                            excluded
                              ? t("Stop excluding meetings titled “{title}”", { title: r.subject })
                              : t("Always uncheck meetings titled “{title}” (adds an exclude rule)", { title: r.subject })
                          }
                        >
                          {excluded ? t("Include") : t("Exclude")}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-zinc-500">
          {t("{selected} of {total} meetings selected · {hours} h", {
            selected: selectedRows.length,
            total: rows.length,
            hours: Math.round(selectedHours * 100) / 100,
          })}
        </p>
        <button type="submit" className="btn btn-primary" disabled={pending || selectedRows.length === 0}>
          {pending
            ? t("Booking…")
            : selectedRows.length === 1
              ? t("Book 1 meeting")
              : t("Book {n} meetings", { n: selectedRows.length })}
        </button>
      </div>
      {state?.error && <p className="alert-error whitespace-pre-line">{state.error}</p>}
    </form>
  );
}
