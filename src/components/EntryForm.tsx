"use client";

import { useRef, useState, useTransition } from "react";
import type { ActionState } from "@/app/action-helpers";
import type { EntryType } from "@/db/schema";
import { ENTRY_CONTEXT_PREFIX } from "@/lib/contexts-shared";
import type { EntryTypeDef } from "@/lib/entry-types-shared";
import { bookOnValue, parseBookOn, type ProjectOption } from "@/lib/projects-shared";
import { dedupeTags, pickDefaultTags, type DefaultTagMaps } from "@/lib/tags-shared";
import { inferType, type TypeRule } from "@/lib/type-rules-shared";
import { parseHours } from "@/lib/format";
import { useT } from "./I18nProvider";
import { ContextFields, useContextDraft } from "./ContextForm";
import { TagInput } from "./TagInput";
import { Switch } from "./Switch";
import { TicketCombobox } from "./TicketCombobox";

export type EntryFormJob = { id: number; number: string; name: string; customer: string | null };

export type EntryFormProject = ProjectOption;

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
  /** Book on this project (takes precedence over jobNumber). */
  projectId: number;
  date: string;
  hours: number;
  description: string;
  /** A note of your own on the entry (not part of the booking's text). */
  comment: string;
  ticket: string;
  reportedBy: string;
  type: EntryType;
  tags: string[];
  /** A group entry (a mob day): the day's work is itemized under it. */
  isGroup: boolean;
  /** When the work began, "HH:MM". */
  start: string;
}>;

export function EntryForm({
  jobs,
  projects = [],
  action,
  defaults = {},
  submitLabel,
  resetOnSuccess = true,
  allTags = [],
  ticketSuggestions = [],
  typeRules = [],
  defaultTagMaps = { jobs: {}, projects: {}, tickets: {} },
  types,
  withContext = false,
  groupDays = {},
}: {
  jobs: EntryFormJob[];
  projects?: EntryFormProject[];
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  defaults?: EntryFormDefaults;
  submitLabel?: string;
  resetOnSuccess?: boolean;
  allTags?: string[];
  ticketSuggestions?: TicketSuggestionLite[];
  /** Rules that infer the type from job + description (Settings → Entry type rules). */
  typeRules?: TypeRule[];
  /** Default tags of jobs, projects and tickets — filled in as you pick them. */
  defaultTagMaps?: DefaultTagMaps;
  /** The configured entry types (Tags page). */
  types: EntryTypeDef[];
  /**
   * Offer "+ Add context" (a colleague's message, links, files) to save with the new entry.
   * Needs a ContextFormOptionsProvider around the form for its pickers.
   */
  withContext?: boolean;
  /** Days that have a group entry (a mob day): date → its name. */
  groupDays?: Record<string, string>;
}) {
  const t = useT();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, setState] = useState<ActionState>(null);
  const [pending, startTransition] = useTransition();
  // "+ Add context": its ticket and date are the entry's until changed there.
  const context = useContextDraft({ ticket: defaults.ticket ?? "", date: defaults.date ?? "" }, { fromEntry: true });
  const [contextOpen, setContextOpen] = useState(false);
  // On a day with a group entry (a mob day) an entry is grouped by default — "Separate entry" books it on its own.
  const [entryDate, setEntryDate] = useState(defaults.date ?? "");
  // The comment field is there from the start when the entry has one, else behind "+ Comment".
  const [commentOpen, setCommentOpen] = useState(!!defaults.comment);
  const [separate, setSeparate] = useState(false);
  const [isGroup, setIsGroup] = useState(!!defaults.isGroup);

  /** The type an untouched entry gets: a matching type rule, else Ticket with a ticket, else Other. */
  const autoType = (job: string, description: string, tk: string): EntryType =>
    inferType(typeRules, { jobNumber: job, description }) ?? (tk.trim() ? "ticket" : "other");

  /** The job a "Book on" value lands on: the job itself, or the project's job ("" = no job yet). */
  const jobOf = (value: string): string => {
    const b = parseBookOn(value);
    if (!b) return "";
    if ("jobNumber" in b) return b.jobNumber;
    return projects.find((p) => p.id === b.projectId)?.jobNumber ?? "";
  };

  const initialBookOn = defaults.projectId
    ? bookOnValue({ projectId: defaults.projectId })
    : bookOnValue({ jobNumber: defaults.jobNumber ?? jobs[0]?.number ?? "" });
  const initialType: EntryType =
    defaults.type ?? autoType(jobOf(initialBookOn), defaults.description ?? "", defaults.ticket ?? "");
  const [bookOn, setBookOn] = useState(initialBookOn);
  const [ticket, setTicket] = useState(defaults.ticket ?? "");
  const [description, setDescription] = useState(defaults.description ?? "");
  const [type, setType] = useState<EntryType>(initialType);
  // Once you pick a type yourself (or edit an existing entry), it stops following the rules.
  const [typeTouched, setTypeTouched] = useState(!!defaults.type);
  const [tagKey, setTagKey] = useState(0);

  /** The default tags for a booking: its job's (a project's job too), its project's and its ticket's. */
  const defaultTagsFor = (value: string, tk: string): string[] => {
    const b = parseBookOn(value);
    return pickDefaultTags(defaultTagMaps, { jobNumber: jobOf(value), projectId: b && "projectId" in b ? b.projectId : null, ticket: tk });
  };
  // A new entry starts with its defaults; an edited one keeps its tags.
  const initialAuto = defaults.tags ? [] : defaultTagsFor(initialBookOn, defaults.ticket ?? "");
  const initialTags = defaults.tags ?? initialAuto;
  const [tags, setTags] = useState<string[]>(initialTags);
  const [autoTags, setAutoTags] = useState<string[]>(initialAuto);

  /** Swap the previous selection's default tags for the new one's; tags you added yourself stay. */
  function refreshDefaultTags(value: string, tk: string) {
    const next = defaultTagsFor(value, tk);
    const prev = new Set(autoTags.map((t) => t.toLowerCase()));
    setTags((cur) => dedupeTags([...cur.filter((t) => !prev.has(t.toLowerCase())), ...next]));
    setAutoTags(next);
  }

  const retype = (next: { job?: string; description?: string; ticket?: string }) => {
    if (!typeTouched) setType(autoType(next.job ?? jobOf(bookOn), next.description ?? description, next.ticket ?? ticket));
  };

  function onBookOnChange(v: string) {
    setBookOn(v);
    retype({ job: jobOf(v) });
    refreshDefaultTags(v, ticket);
  }

  function onTicketChange(v: string) {
    setTicket(v);
    context.followEntry({ ticket: v });
    const match = ticketSuggestions.find((s) => s.ticket.toLowerCase() === v.trim().toLowerCase());
    // Reuse the ticket's job — unless you're booking on a project, which keeps its job.
    const reuse = match && !bookOn.startsWith("p:");
    const nextBookOn = reuse ? bookOnValue({ jobNumber: match.jobNumber }) : bookOn;
    if (reuse) setBookOn(nextBookOn);
    retype({ job: reuse ? match.jobNumber : undefined, ticket: v });
    refreshDefaultTags(nextBookOn, v);
  }

  /** The description lives in TagInput; follow its textarea through the bubbling change event (and the date for the context). */
  function onFormChange(e: React.FormEvent<HTMLFormElement>) {
    const el = e.target as HTMLTextAreaElement;
    if (el.name === "date") {
      context.followEntry({ date: el.value });
      setEntryDate(el.value);
    }
    if (el.name !== "description") return;
    setDescription(el.value);
    retype({ description: el.value });
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // The context's pictures being fetched, or its link being looked up, go along once they're here.
    if (withContext && (context.fetching || context.resolving)) return;
    const fd = new FormData(e.currentTarget);
    const typedHours = parseHours(String(fd.get("hours") ?? ""));
    if (typedHours !== null) fd.set("hours", String(typedHours)); // "1,5" and "1:30" reach the server as 1.5
    startTransition(async () => {
      if (withContext) await context.prepare(fd, ENTRY_CONTEXT_PREFIX);
      const result = await action(null, fd);
      setState(result ?? null);
      if (result?.ok && resetOnSuccess) {
        formRef.current?.reset();
        setBookOn(initialBookOn);
        setTicket(defaults.ticket ?? "");
        setDescription(defaults.description ?? "");
        setType(initialType);
        setTypeTouched(!!defaults.type);
        setTags(initialTags);
        setAutoTags(initialAuto);
        setTagKey((k) => k + 1);
        context.reset();
        setContextOpen(false);
      }
    });
  }

  if (jobs.length === 0 && projects.length === 0) {
    return (
      <p className="text-sm text-zinc-500">
        {t("No active jobs yet — create one on the Jobs page before booking time.")}
      </p>
    );
  }

  const jobOptions = jobs.map((j) => (
    <option key={j.id} value={bookOnValue({ jobNumber: j.number })}>
      {j.number} — {j.name}{j.customer ? ` (${j.customer})` : ""}
    </option>
  ));

  return (
    <div className="space-y-2">
      <form ref={formRef} onSubmit={onSubmit} onChange={onFormChange} className="grid gap-3 sm:grid-cols-6">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="bookOn">{projects.length ? t("Book on") : t("Job")}</label>
          <select id="bookOn" name="bookOn" className="input" value={bookOn} onChange={(e) => onBookOnChange(e.target.value)} required>
            {projects.length > 0 ? (
              <>
                <optgroup label={t("Projects")}>
                  {projects.map((p) => (
                    <option key={p.id} value={bookOnValue({ projectId: p.id })}>
                      {p.title} {p.jobNumber ? `→ ${p.jobNumber}` : t("(no job yet)")}
                    </option>
                  ))}
                </optgroup>
                <optgroup label={t("Jobs")}>{jobOptions}</optgroup>
              </>
            ) : (
              jobOptions
            )}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="type">{t("Type")}</label>
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
            {!types.some((t) => t.key === type) && <option value={type}>{type}</option>}
            {types.map((t) => (
              <option key={t.key} value={t.key}>{t.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="date">{t("Date")}</label>
          <input id="date" name="date" type="date" className="input" defaultValue={defaults.date} required />
        </div>
        <div>
          <label className="label" htmlFor="hours">{t("Hours")}</label>
          <input id="hours" name="hours" type="text" inputMode="decimal" placeholder="1.5" className="input num" defaultValue={defaults.hours} required />
        </div>
        <div>
          <label className="label" htmlFor="start">{t("Start")}</label>
          <input id="start" name="start" type="time" className="input" defaultValue={defaults.start} />
        </div>
        <div>
          <label className="label" htmlFor="ticket">{t("Ticket")}</label>
          <TicketCombobox value={ticket} onChange={onTicketChange} suggestions={ticketSuggestions} />
        </div>
        <div className="sm:col-span-6">
          <label className="label">{t("Report")}</label>
          <TagInput
            key={tagKey}
            allTags={allTags}
            defaultDescription={defaults.description ?? ""}
            tags={tags}
            onTagsChange={setTags}
            autoTags={autoTags}
            required
          />
        </div>
        <div className="sm:col-span-6">
          {commentOpen ? (
            <>
              <label className="label" htmlFor="comment">{t("Comment")}</label>
              <textarea id="comment" name="comment" rows={2} className="input w-full" defaultValue={defaults.comment ?? ""} placeholder={t("Your own note on this entry — it isn't part of the booking's report text")} autoFocus={!defaults.comment} />
            </>
          ) : (
            <button type="button" className="text-sm text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => setCommentOpen(true)}>
              + {t("Comment")}
            </button>
          )}
        </div>
        {groupDays[entryDate] && !isGroup && (
          <div className="flex flex-wrap items-center gap-3 sm:col-span-6">
            <Switch checked={!separate} onChange={(on) => setSeparate(!on)} labelOn={t("Group entry")} labelOff={t("Separate entry")} />
            <input type="hidden" name="placement" value={separate ? "separate" : "group"} />
            <span className="text-xs text-zinc-500">{t("{day} has the group entry “{group}”: work that runs parallel to it (by its start and hours) is grouped by default.", { day: entryDate, group: groupDays[entryDate] })}</span>
          </div>
        )}
        <label className="flex items-start gap-2 text-sm sm:col-span-6">
          <input type="checkbox" name="isGroup" className="mt-0.5 size-4 accent-indigo-600" checked={isGroup} onChange={(e) => setIsGroup(e.target.checked)} />
          <span>
            {t("This entry collects the day's work (e.g. Mob Programming)")}
            <span className="block text-xs text-zinc-500">{t("The hours are booked once, as they are here. What you implement that day and that runs parallel to it (by start and hours) is itemized under this entry — not booked on top, and traceable through the todos.")}</span>
          </span>
        </label>
        {withContext && (
          <details
            className="rounded-lg border border-dashed border-zinc-300 p-3 sm:col-span-6 dark:border-zinc-700"
            open={contextOpen}
            onToggle={(e) => setContextOpen(e.currentTarget.open)}
          >
            <summary className="cursor-pointer text-sm font-medium text-zinc-600 dark:text-zinc-300">
              {t("+ Add context")}
              <span className="ml-2 font-normal text-zinc-400">
                {context.hasContent ? t("· saved with the entry") : t("Teams messages, merge requests, a note — kept with this entry")}
              </span>
            </summary>
            <div className="mt-3">
              {/* On the entry's ticket (or the one a merge request names): the Ticket field above. */}
              <ContextFields draft={context} prefix={ENTRY_CONTEXT_PREFIX} ticket={false} />
            </div>
          </details>
        )}
        <div className="flex items-end">
          <button type="submit" className="btn btn-primary w-full" disabled={pending || (withContext && context.fetching > 0)}>
            {pending ? t("Saving…") : withContext && context.fetching > 0 ? t("Fetching pictures…") : (submitLabel ?? t("Add entry"))}
          </button>
        </div>
      </form>
      {state?.error && <p role="alert" className="alert-error">{state.error}</p>}
      {state?.ok && state.message && <p role="status" className="alert-ok">{state.message}</p>}
    </div>
  );
}
