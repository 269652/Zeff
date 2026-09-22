"use client";

import { useRef, useState, useTransition } from "react";
import type { ActionState } from "@/app/actions";
import type { EntryType } from "@/db/schema";
import { TagInput } from "./TagInput";

export type EntryFormJob = { id: number; number: string; name: string; customer: string | null };

export type TicketSuggestionLite = {
  ticket: string;
  jobNumber: string;
  jobName: string;
  description: string;
};

export type EntryFormDefaults = Partial<{
  jobNumber: string;
  date: string;
  hours: number;
  description: string;
  ticket: string;
  reportedBy: string;
  type: EntryType;
  tags: string[];
}>;

const TYPES: { value: EntryType; label: string }[] = [
  { value: "ticket", label: "Ticket" },
  { value: "meeting", label: "Meeting" },
  { value: "other", label: "Other" },
];

export function EntryForm({
  jobs,
  action,
  defaults = {},
  submitLabel = "Add entry",
  resetOnSuccess = true,
  allTags = [],
  ticketSuggestions = [],
}: {
  jobs: EntryFormJob[];
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  defaults?: EntryFormDefaults;
  submitLabel?: string;
  resetOnSuccess?: boolean;
  allTags?: string[];
  ticketSuggestions?: TicketSuggestionLite[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, setState] = useState<ActionState>(null);
  const [pending, startTransition] = useTransition();

  const initialJob = defaults.jobNumber ?? jobs[0]?.number ?? "";
  const initialType: EntryType = defaults.type ?? (defaults.ticket ? "ticket" : "other");
  const [jobNumber, setJobNumber] = useState(initialJob);
  const [ticket, setTicket] = useState(defaults.ticket ?? "");
  const [type, setType] = useState<EntryType>(initialType);
  const [tagKey, setTagKey] = useState(0);

  function onTicketChange(v: string) {
    setTicket(v);
    const match = ticketSuggestions.find((s) => s.ticket.toLowerCase() === v.trim().toLowerCase());
    if (match) setJobNumber(match.jobNumber); // reuse the ticket's job
    if (v.trim() && type === "other") setType("ticket");
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await action(null, fd);
      setState(result ?? null);
      if (result?.ok && resetOnSuccess) {
        formRef.current?.reset();
        setJobNumber(initialJob);
        setTicket(defaults.ticket ?? "");
        setType(initialType);
        setTagKey((k) => k + 1);
      }
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
    <div className="space-y-2">
      <form ref={formRef} onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-6">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="jobNumber">Job</label>
          <select id="jobNumber" name="jobNumber" className="input" value={jobNumber} onChange={(e) => setJobNumber(e.target.value)} required>
            {jobs.map((j) => (
              <option key={j.id} value={j.number}>
                {j.number} — {j.name}{j.customer ? ` (${j.customer})` : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="type">Type</label>
          <select id="type" name="type" className="input" value={type} onChange={(e) => setType(e.target.value as EntryType)}>
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
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
          <input
            id="ticket"
            name="ticket"
            type="text"
            list="ticket-suggestions"
            placeholder="PROJ-337"
            className="input"
            value={ticket}
            onChange={(e) => onTicketChange(e.target.value)}
            autoComplete="off"
          />
          <datalist id="ticket-suggestions">
            {ticketSuggestions.map((s) => (
              <option key={s.ticket} value={s.ticket}>{s.jobName} — {s.description}</option>
            ))}
          </datalist>
        </div>
        <div className="sm:col-span-6">
          <label className="label">Description</label>
          <TagInput
            key={tagKey}
            allTags={allTags}
            defaultDescription={defaults.description ?? ""}
            defaultTags={defaults.tags ?? []}
            required
          />
        </div>
        <div className="flex items-end">
          <button type="submit" className="btn btn-primary w-full" disabled={pending}>
            {pending ? "Saving…" : submitLabel}
          </button>
        </div>
      </form>
      {state?.error && <p className="alert-error">{state.error}</p>}
      {state?.ok && state.message && <p className="alert-ok">{state.message}</p>}
    </div>
  );
}
