"use client";

import { useRef, useState, useTransition } from "react";
import type { ActionState } from "@/app/actions";

export type EntryFormJob = { id: number; number: string; name: string; customer: string | null };

export type EntryFormDefaults = Partial<{
  jobNumber: string;
  date: string;
  hours: number;
  description: string;
  ticket: string;
  reportedBy: string;
}>;

export function EntryForm({
  jobs,
  action,
  defaults = {},
  submitLabel = "Add entry",
  resetOnSuccess = true,
}: {
  jobs: EntryFormJob[];
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  defaults?: EntryFormDefaults;
  submitLabel?: string;
  resetOnSuccess?: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, setState] = useState<ActionState>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await action(null, fd);
      setState(result ?? null);
      if (result?.ok && resetOnSuccess) formRef.current?.reset();
    });
  }

  if (jobs.length === 0) {
    return (
      <p className="text-sm text-zinc-500">
        No active jobs yet — create one on the Jobs page before booking time.
      </p>
    );
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-6">
      <div className="sm:col-span-2">
        <label className="label" htmlFor="jobNumber">Job</label>
        <select id="jobNumber" name="jobNumber" className="input" defaultValue={defaults.jobNumber ?? jobs[0].number} required>
          {jobs.map((j) => (
            <option key={j.id} value={j.number}>
              {j.number} — {j.name}{j.customer ? ` (${j.customer})` : ""}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="date">Date</label>
        <input id="date" name="date" type="date" className="input" defaultValue={defaults.date} required />
      </div>
      <div>
        <label className="label" htmlFor="hours">Hours</label>
        <input id="hours" name="hours" type="number" step="0.25" min="0.25" max="24" inputMode="decimal" placeholder="1.5" className="input num" defaultValue={defaults.hours} required />
      </div>
      <div>
        <label className="label" htmlFor="ticket">Ticket</label>
        <input id="ticket" name="ticket" type="text" placeholder="PROJ-337" className="input" defaultValue={defaults.ticket} />
      </div>
      <div>
        <label className="label" htmlFor="reportedBy">Reported by</label>
        <input id="reportedBy" name="reportedBy" type="text" placeholder="your name" className="input" defaultValue={defaults.reportedBy} />
      </div>
      <div className="sm:col-span-5">
        <label className="label" htmlFor="description">Description</label>
        <input id="description" name="description" type="text" placeholder="What was done?" className="input" defaultValue={defaults.description} required />
      </div>
      <div className="flex items-end">
        <button type="submit" className="btn btn-primary w-full" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </button>
      </div>
      {state?.error && <p className="alert-error sm:col-span-6">{state.error}</p>}
      {state?.ok && state.message && <p className="alert-ok sm:col-span-6">{state.message}</p>}
    </form>
  );
}
