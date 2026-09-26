"use client";

import { useRef, useState, useTransition } from "react";
import type { ActionState } from "@/app/actions";
import type { EntryType } from "@/db/schema";
import { inferType, type TypeRule } from "@/lib/type-rules-shared";
import { TagInput } from "./TagInput";
import { TicketCombobox } from "./TicketCombobox";

export type EntryFormJob = { id: number; number: string; name: string; customer: string | null };

export type TicketSuggestionLite = {
  ticket: string;
  jobNumber: string;
  jobName: string;
  description: string;
  assignee?: string | null;
  mine?: boolean;
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
  { value: "absence", label: "Absence" },
  { value: "internal", label: "Internal" },
];

export function EntryForm({
  jobs,
  action,
  defaults = {},
  submitLabel = "Add entry",
  resetOnSuccess = true,
  allTags = [],
  ticketSuggestions = [],
  typeRules = [],
}: {
  jobs: EntryFormJob[];
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  defaults?: EntryFormDefaults;
  submitLabel?: string;
  resetOnSuccess?: boolean;
  allTags?: string[];
  ticketSuggestions?: TicketSuggestionLite[];
  /** Rules that infer the type from job + description (Settings → Entry type rules). */
  typeRules?: TypeRule[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, setState] = useState<ActionState>(null);
  const [pending, startTransition] = useTransition();

  /** The type an untouched entry gets: a matching type rule, else Ticket with a ticket, else Other. */
  const autoType = (job: string, description: string, tk: string): EntryType =>
    inferType(typeRules, { jobNumber: job, description }) ?? (tk.trim() ? "ticket" : "other");

  const initialJob = defaults.jobNumber ?? jobs[0]?.number ?? "";
  const initialType: EntryType = defaults.type ?? autoType(initialJob, defaults.description ?? "", defaults.ticket ?? "");
  const [jobNumber, setJobNumber] = useState(initialJob);
  const [ticket, setTicket] = useState(defaults.ticket ?? "");
  const [description, setDescription] = useState(defaults.description ?? "");
  const [type, setType] = useState<EntryType>(initialType);
  // Once you pick a type yourself (or edit an existing entry), it stops following the rules.
  const [typeTouched, setTypeTouched] = useState(!!defaults.type);
  const [tagKey, setTagKey] = useState(0);

  const retype = (next: { job?: string; description?: string; ticket?: string }) => {
    if (!typeTouched) setType(autoType(next.job ?? jobNumber, next.description ?? description, next.ticket ?? ticket));
  };

  function onJobChange(v: string) {
    setJobNumber(v);
    retype({ job: v });
  }

  function onTicketChange(v: string) {
    setTicket(v);
    const match = ticketSuggestions.find((s) => s.ticket.toLowerCase() === v.trim().toLowerCase());
    if (match) setJobNumber(match.jobNumber); // reuse the ticket's job
    retype({ job: match?.jobNumber, ticket: v });
  }

  /** The description lives in TagInput; follow its textarea through the bubbling change event. */
  function onFormChange(e: React.FormEvent<HTMLFormElement>) {
    const el = e.target as HTMLTextAreaElement;
    if (el.name !== "description") return;
    setDescription(el.value);
    retype({ description: el.value });
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
        setDescription(defaults.description ?? "");
        setType(initialType);
        setTypeTouched(!!defaults.type);
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
      <form ref={formRef} onSubmit={onSubmit} onChange={onFormChange} className="grid gap-3 sm:grid-cols-6">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="jobNumber">Job</label>
          <select id="jobNumber" name="jobNumber" className="input" value={jobNumber} onChange={(e) => onJobChange(e.target.value)} required>
            {jobs.map((j) => (
              <option key={j.id} value={j.number}>
                {j.number} — {j.name}{j.customer ? ` (${j.customer})` : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="type">Type</label>
          <select
            id="type"
            name="type"
            className="input"
            value={type}
            onChange={(e) => {
              setType(e.target.value as EntryType);
              setTypeTouched(true);
            }}
          >
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
          <TicketCombobox value={ticket} onChange={onTicketChange} suggestions={ticketSuggestions} />
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
