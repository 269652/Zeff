"use client";

import { useState, useTransition } from "react";
import { importMeetingsAction, type ActionState } from "@/app/actions";
import type { Meeting, MeetingFlag } from "@/lib/calendar/meetings";
import type { EntryFormJob } from "./EntryForm";

type Row = Meeting & { jobNumber: string; description: string; ticketValue: string; hoursValue: string };

const FLAG_LABEL: Record<MeetingFlag, string> = {
  imported: "already booked",
  tentative: "tentative",
  free: "shown as free",
  private: "private",
};

export function MeetingImportForm({
  weekKey,
  meetings,
  jobs,
  defaultReportedBy,
}: {
  weekKey: string;
  meetings: Meeting[];
  jobs: EntryFormJob[];
  defaultReportedBy: string;
}) {
  const [defaultJob, setDefaultJob] = useState(jobs[0]?.number ?? "");
  const [rows, setRows] = useState<Row[]>(() =>
    meetings.map((m) => ({
      ...m,
      jobNumber: jobs[0]?.number ?? "",
      description: m.subject,
      ticketValue: m.ticket ?? "",
      hoursValue: String(m.hours),
    })),
  );
  const [state, setState] = useState<ActionState>(null);
  const [pending, startTransition] = useTransition();

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
    return <p className="text-sm text-zinc-500">Create a job first — meetings are booked on a job number.</p>;
  }
  if (rows.length === 0) {
    return <p className="py-4 text-center text-sm text-zinc-500">No finished meetings to import in this week.</p>;
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <input type="hidden" name="rowCount" value={rows.length} />
      <input type="hidden" name="week" value={weekKey} />

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-64">
          <label className="label" htmlFor="defaultJob">Book all meetings on</label>
          <select id="defaultJob" className="input" value={defaultJob} onChange={(e) => applyJobToAll(e.target.value)}>
            {jobs.map((j) => (
              <option key={j.id} value={j.number}>{j.number} — {j.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="reportedBy">Reported by</label>
          <input id="reportedBy" name="reportedBy" className="input" defaultValue={defaultReportedBy} placeholder="your name" />
        </div>
        <div className="flex gap-1 pb-0.5">
          <button type="button" className="btn btn-sm" onClick={() => setAll(true)}>Select all</button>
          <button type="button" className="btn btn-sm" onClick={() => setAll(false)}>None</button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th></th>
              <th>Date</th>
              <th>Time</th>
              <th>Meeting → description</th>
              <th className="num">Hours</th>
              <th>Ticket</th>
              <th>Job</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const imported = r.flags.includes("imported");
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
                    {r.organizer && <div className="mt-0.5 text-xs text-zinc-500">by {r.organizer}</div>}
                  </td>
                  <td>
                    <input name={`hours-${i}`} type="number" step="0.25" min="0.25" max="24" className="input num w-20" value={r.hoursValue} onChange={(e) => update(i, { hoursValue: e.target.value })} disabled={imported} />
                    <div className="mt-0.5 text-right text-xs text-zinc-500">{r.minutes} min</div>
                  </td>
                  <td>
                    <input name={`ticket-${i}`} className="input w-28 font-mono" value={r.ticketValue} onChange={(e) => update(i, { ticketValue: e.target.value })} disabled={imported} placeholder="—" />
                  </td>
                  <td>
                    <select name={`job-${i}`} className="input min-w-44" value={r.jobNumber} onChange={(e) => update(i, { jobNumber: e.target.value })} disabled={imported}>
                      {jobs.map((j) => (
                        <option key={j.id} value={j.number}>{j.number}</option>
                      ))}
                    </select>
                  </td>
                  <td className="whitespace-nowrap">
                    <div className="flex flex-wrap gap-1">
                      {r.isTeams && <span className="badge badge-mcp">Teams</span>}
                      {r.flags.map((f) => (
                        <span key={f} className="badge badge-web">{FLAG_LABEL[f]}</span>
                      ))}
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
          {selectedRows.length} of {rows.length} meetings selected · {Math.round(selectedHours * 100) / 100} h
        </p>
        <button type="submit" className="btn btn-primary" disabled={pending || selectedRows.length === 0}>
          {pending ? "Booking…" : `Book ${selectedRows.length} meeting${selectedRows.length === 1 ? "" : "s"}`}
        </button>
      </div>
      {state?.error && <p className="alert-error whitespace-pre-line">{state.error}</p>}
    </form>
  );
}
