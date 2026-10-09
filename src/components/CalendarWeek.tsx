"use client";

import { useState, useTransition } from "react";
import { importMeetingsAction, type ActionState } from "@/app/actions";
import type { MeetingFlag } from "@/lib/calendar/meetings";
import type { CalendarDay, CalendarEvent, CalendarEventState } from "@/lib/calendar/week-view";
import { formatHours, round2 } from "@/lib/format";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const STATE_LABEL: Partial<Record<CalendarEventState, string>> = {
  booked: "booked",
  later: "later today",
  upcoming: "upcoming",
  cancelled: "cancelled",
  declined: "declined",
  "too-long": "longer than a day",
};

const FLAG_LABEL: Partial<Record<MeetingFlag, string>> = {
  excluded: "excluded",
  tentative: "tentative",
  free: "free",
  private: "private",
};

/** Ticked by default or by hand: over and not booked yet, or still to come today. */
const selectable = (e: CalendarEvent) => e.state === "importable" || e.state === "later";

/**
 * A week of synced Outlook meetings as day columns. Click a meeting to tick or untick it
 * (finished, unbooked ones start ticked unless excluded / tentative / free / private); a
 * ticked one shows the job it's booked on. Import books every ticked meeting up to today.
 */
export function CalendarWeek({
  weekKey,
  days,
  jobs,
  today,
}: {
  weekKey: string;
  days: CalendarDay[];
  jobs: { number: string; name: string }[];
  today: string;
}) {
  const events = days.flatMap((d) => d.events);
  const defaults = () => new Set(events.filter((e) => selectable(e) && e.selected).map((e) => e.externalId));
  const [selected, setSelected] = useState<Set<string>>(defaults);
  const [jobOf, setJobOf] = useState<Record<string, string>>(() => Object.fromEntries(events.map((e) => [e.externalId, e.jobNumber])));
  const [state, setState] = useState<ActionState>(null);
  const [pending, startTransition] = useTransition();

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // Never anything after today, whatever is ticked.
  const toImport = events.filter((e) => selectable(e) && selected.has(e.externalId) && e.date <= today);
  const hours = round2(toImport.reduce((a, e) => a + e.hours, 0));

  function importSelected() {
    const fd = new FormData();
    fd.set("rowCount", String(toImport.length));
    fd.set("week", weekKey);
    fd.set("returnTo", "calendar");
    toImport.forEach((e, i) => {
      fd.set(`include-${i}`, "on");
      fd.set(`externalId-${i}`, e.externalId);
      fd.set(`date-${i}`, e.date);
      fd.set(`hours-${i}`, String(e.hours));
      fd.set(`description-${i}`, e.subject);
      fd.set(`ticket-${i}`, e.ticket ?? "");
      fd.set(`job-${i}`, jobOf[e.externalId] ?? e.jobNumber);
    });
    startTransition(async () => setState(await importMeetingsAction(null, fd)));
  }

  const jobOptions = (current: string) =>
    current && !jobs.some((j) => j.number === current) ? [{ number: current, name: "" }, ...jobs] : jobs;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-zinc-500">
          {toImport.length} meeting{toImport.length === 1 ? "" : "s"} ticked · {formatHours(hours)} h — imports up to today
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-sm" onClick={() => setSelected(defaults())} disabled={pending}>
            Reset
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setSelected(new Set())} disabled={pending}>
            None
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={importSelected} disabled={pending || toImport.length === 0}>
            {pending ? "Importing…" : `Import ${toImport.length} meeting${toImport.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
      {state?.error && <p className="alert-error whitespace-pre-line">{state.error}</p>}

      <div className="overflow-x-auto pb-1">
        <div className="grid min-w-[64rem] grid-cols-7 gap-2">
          {days.map((d, i) => {
            const isToday = d.date === today;
            const dayHours = round2(d.events.filter((e) => toImport.includes(e)).reduce((a, e) => a + e.hours, 0));
            return (
              <div
                key={d.date}
                className={`rounded-lg border p-1.5 ${
                  isToday ? "border-indigo-300 bg-indigo-50/40 dark:border-indigo-800 dark:bg-indigo-950/20" : "border-zinc-200 dark:border-zinc-800"
                }`}
              >
                <div className="flex items-baseline justify-between px-1 pb-1.5 text-xs font-semibold">
                  <span className={isToday ? "text-indigo-600 dark:text-indigo-400" : i >= 5 ? "text-zinc-400" : ""}>
                    {WEEKDAYS[i]} {Number(d.date.slice(8))}.{Number(d.date.slice(5, 7))}.
                  </span>
                  {dayHours > 0 && <span className="font-normal tabular-nums text-zinc-500">{formatHours(dayHours)} h</span>}
                </div>
                {d.allDay.length > 0 && (
                  <div className="mb-1.5 space-y-0.5">
                    {d.allDay.map((e) => (
                      <div key={e.externalId} className="truncate rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-500 dark:bg-zinc-800" title={`${e.subject} (all day)`}>
                        {e.subject}
                      </div>
                    ))}
                  </div>
                )}
                <div className="space-y-1">
                  {d.events.length === 0 && d.allDay.length === 0 && <div className="px-1 py-2 text-[11px] text-zinc-300 dark:text-zinc-700">—</div>}
                  {d.events.map((e) => (
                    <EventCard
                      key={e.externalId}
                      event={e}
                      on={selected.has(e.externalId)}
                      onToggle={() => toggle(e.externalId)}
                      job={jobOf[e.externalId] ?? e.jobNumber}
                      jobs={jobOptions(jobOf[e.externalId] ?? e.jobNumber)}
                      onJob={(number) => setJobOf((m) => ({ ...m, [e.externalId]: number }))}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function EventCard({
  event: e,
  on,
  onToggle,
  job,
  jobs,
  onJob,
}: {
  event: CalendarEvent;
  on: boolean;
  onToggle: () => void;
  job: string;
  jobs: { number: string; name: string }[];
  onJob: (number: string) => void;
}) {
  const canTick = selectable(e);
  const tone =
    canTick && on
      ? "border-indigo-400 bg-indigo-50 dark:border-indigo-600 dark:bg-indigo-950/40"
      : e.state === "booked"
        ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"
        : e.state === "later"
          ? "border-dashed border-amber-300 bg-white dark:border-amber-800 dark:bg-zinc-950"
          : e.state === "importable"
            ? "border-zinc-200 bg-white hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-600"
            : "border-dashed border-zinc-200 bg-zinc-50 text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900/50";
  const badges = [STATE_LABEL[e.state], ...e.flags.map((f) => FLAG_LABEL[f])].filter(Boolean) as string[];
  const title = [
    `${e.subject} · ${e.startTime}–${e.endTime}`,
    e.organizer ? `by ${e.organizer}` : "",
    canTick ? (on ? "ticked — click to leave it out" : "click to import it") : STATE_LABEL[e.state] ?? "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      role={canTick ? "checkbox" : undefined}
      aria-checked={canTick ? on : undefined}
      tabIndex={canTick ? 0 : undefined}
      onClick={canTick ? onToggle : undefined}
      onKeyDown={
        canTick
          ? (ev) => {
              if (ev.key === " " || ev.key === "Enter") {
                ev.preventDefault();
                onToggle();
              }
            }
          : undefined
      }
      title={title}
      className={`rounded-md border px-1.5 py-1 transition ${tone} ${canTick ? "cursor-pointer" : ""}`}
    >
      <div className="flex items-start gap-1.5">
        <span
          className={`mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-sm border text-[10px] leading-none ${
            e.state === "booked"
              ? "border-emerald-500 bg-emerald-500 text-white"
              : canTick && on
                ? "border-indigo-500 bg-indigo-500 text-white"
                : "border-zinc-300 dark:border-zinc-600"
          }`}
          aria-hidden
        >
          {e.state === "booked" || (canTick && on) ? "✓" : ""}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex justify-between gap-1 text-[11px] tabular-nums opacity-70">
            <span>
              {e.startTime}–{e.endTime}
            </span>
            <span>{formatHours(e.hours)} h</span>
          </div>
          <div className={`line-clamp-2 text-xs leading-snug font-medium ${e.state === "cancelled" || e.state === "declined" ? "line-through" : ""}`}>
            {e.subject}
          </div>
          {badges.length > 0 && (
            <div className="mt-0.5 flex flex-wrap gap-0.5">
              {badges.map((b) => (
                <span key={b} className="rounded bg-black/5 px-1 text-[10px] dark:bg-white/10">
                  {b}
                </span>
              ))}
            </div>
          )}
          {canTick && on && (
            <select
              className="mt-1 w-full rounded border border-zinc-300 bg-white px-1 py-0.5 text-[11px] dark:border-zinc-700 dark:bg-zinc-950"
              value={job}
              onClick={(ev) => ev.stopPropagation()}
              onKeyDown={(ev) => ev.stopPropagation()}
              onChange={(ev) => onJob(ev.target.value)}
              aria-label={`Job for ${e.subject}`}
            >
              {jobs.map((j) => (
                <option key={j.number} value={j.number}>
                  {j.number}
                  {j.name ? ` — ${j.name}` : ""}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
    </div>
  );
}
