"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { acceptSuggestionAction, skipSuggestionAction } from "@/app/actions";
import { formatDate, formatDateTime, formatHours, formatTime } from "@/lib/format";
import type { SuggestionView } from "@/lib/work/suggestions";
import { formatMinutes } from "@/lib/work/shared";
import { ChevronIcon } from "./icons";
import { toast } from "./Toaster";
import { useT } from "@/components/I18nProvider";

const day = (iso: string) => formatDate(iso);
const time = (iso: string | null) => (iso ? formatDateTime(iso) : "?");

/** What went into a suggestion: the todos it was on, the runs it books (who, how long, what they reported). */
function Evidence({ s }: { s: SuggestionView }) {
  const t = useT();
  return (
    <ul className="mt-1.5 space-y-1 text-xs text-zinc-600 dark:text-zinc-300">
      {s.todos.map((todo) => (
        <li key={`t${todo.id}`} className="flex gap-1.5">
          <Link href={`/t/${todo.id}`} className="shrink-0 font-mono text-indigo-600 hover:underline dark:text-indigo-400">
            {todo.ref}
          </Link>
          <span className={todo.status === "open" ? "" : "text-zinc-400 line-through decoration-zinc-300"}>{todo.text}</span>
        </li>
      ))}
      {s.times.map((r) => (
        <li key={`m${r.id}`} className="flex gap-1.5">
          <Link href={`/t/${r.todoId}`} className="shrink-0 font-mono text-violet-600 hover:underline dark:text-violet-400">
            {r.todo}
          </Link>
          <span className="min-w-0">
            {formatMinutes(r.minutes)}
            {r.note && <> · {r.note}</>} — {r.source === "hand" ? t("You") : r.by} · {time(r.at)}
          </span>
        </li>
      ))}
      {s.runs.map((r) => (
        <li key={`w${r.id}`} className="flex gap-1.5">
          <Link href={`/work?run=${r.id}`} className="shrink-0 font-mono text-violet-600 hover:underline dark:text-violet-400">
            {r.ref}
          </Link>
          <span className="min-w-0" title={r.summary ?? undefined}>
            {r.agent} · {time(r.startedAt)}–{r.finishedAt ? formatTime(r.finishedAt) : "…"}
            {r.minutes !== null && <> · {t("{n} min", { n: r.minutes })}</>}
            {r.outcome && <> · {r.outcome}</>}
            {r.entryLine && <> · “{r.entryLine}”</>}
          </span>
        </li>
      ))}
      {!s.todos.length && !s.runs.length && !s.times.length && <li className="text-zinc-400">{t("No evidence — only the agent's word.")}</li>}
    </ul>
  );
}

/** One suggestion as a shadow row: day, ticket, job, its line (editable), its hours (± quarters) — taken over or skipped. */
function SuggestionRow({ s }: { s: SuggestionView }) {
  const t = useT();
  const [hours, setHours] = useState(s.hours);
  const [text, setText] = useState(s.description);
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const target = s.project ? s.project.title : s.job ? `${s.job.number} ${s.job.name}` : null;
  const act = (accept: boolean) =>
    start(async () => {
      const r = accept ? await acceptSuggestionAction(s.id, { hours, description: text }) : await skipSuggestionAction(s.id);
      toast(r?.ok ? (r.message ?? t("Done.")) : (r?.error ?? t("Didn't work.")), { tone: r?.ok ? "ok" : "error" });
    });
  const evidence = s.todos.length + s.runs.length + s.times.length;
  return (
    <li className="rounded-md border border-dashed border-zinc-300 bg-zinc-50/60 p-3 dark:border-zinc-700 dark:bg-zinc-900/40">
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-baseline gap-x-2 text-sm text-zinc-600 dark:text-zinc-300">
            <span className="font-mono text-xs text-zinc-400">{s.ref}</span>
            <span className="font-medium">{day(s.date)}</span>
            {s.ticket && <span className="font-mono font-semibold">{s.ticket}</span>}
            {target ? (
              <span className="text-xs text-zinc-500">{target}</span>
            ) : (
              <Link href="/jira" className="text-xs text-amber-700 hover:underline dark:text-amber-400">
                {s.ticket
                  ? t("no job for {ticket} — set one on the Jira tab", { ticket: s.ticket })
                  : t("no job — set one on the Jira tab")}
              </Link>
            )}
            <span className="text-xs text-zinc-400">{t("by {name}", { name: s.reportedBy })}</span>
          </div>
          <input className="input text-sm" value={text} onChange={(e) => setText(e.target.value)} aria-label={t("Description for {ref}", { ref: s.ref })} />
          <button type="button" onClick={() => setOpen(!open)} className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400" aria-expanded={open}>
            <ChevronIcon open={open} className="size-3.5" />
            {t("Evidence ({n})", { n: evidence })}
          </button>
          {open && <Evidence s={s} />}
        </div>
        <div className="flex items-center gap-2 self-start">
          <div className="inline-flex items-center rounded-md border border-zinc-300 dark:border-zinc-700" role="group" aria-label={t("Hours for {ref}", { ref: s.ref })}>
            <button type="button" className="px-2.5 py-1 text-lg leading-none disabled:opacity-40" disabled={hours <= 0.25} onClick={() => setHours(Math.max(0.25, Math.round((hours - 0.25) * 4) / 4))} aria-label={t("A quarter hour less")}>
              −
            </button>
            <span className="min-w-12 text-center font-mono text-sm font-semibold">{formatHours(hours)}</span>
            <button type="button" className="px-2.5 py-1 text-lg leading-none" onClick={() => setHours(Math.min(24, Math.round((hours + 0.25) * 4) / 4))} aria-label={t("A quarter hour more")}>
              +
            </button>
          </div>
          <button type="button" className="btn btn-sm btn-primary" disabled={pending || !target} onClick={() => act(true)} title={
              target
                ? t("Book {hours} h on {day} on {target} — with the evidence as context", { hours: formatHours(hours), day: day(s.date), target })
                : t("Set a job first")
            }
          >
            {pending ? "…" : t("Accept")}
          </button>
          <button type="button" className="btn btn-sm" disabled={pending} onClick={() => act(false)} title={t("Don't book (won't be suggested again)")}>
            {t("Dismiss")}
          </button>
        </div>
      </div>
    </li>
  );
}

/**
 * Bookings agents suggested (MCP report_time, finish_todo) — shadow rows, nothing booked yet:
 * each with its evidence (the todos and runs that went into it), to take over or skip.
 */
export function SuggestionsPanel({ items }: { items: SuggestionView[] }) {
  const t = useT();
  if (!items.length) return null;
  const total = items.reduce((a, s) => a + s.hours, 0);
  return (
    <section id="suggestions" className="card p-4">
      <h2 className="text-sm font-semibold text-zinc-500 uppercase">
        {t("Suggested entries")} <span className="font-normal normal-case text-zinc-400">({items.length} · {formatHours(total)} h)</span>
      </h2>
      <p className="mb-3 text-xs text-zinc-500">{t("Reported by agents, not booked yet — check the hours and the line, then accept.")}</p>
      <ul className="space-y-2">
        {items.map((s) => (
          <SuggestionRow key={s.id} s={s} />
        ))}
      </ul>
    </section>
  );
}
