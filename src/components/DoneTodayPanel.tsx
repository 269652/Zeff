"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { bookDoneTodayAction } from "@/app/actions";
import { addTodoTimeAction } from "@/plugins/todos/server-actions";
import { formatHours } from "@/lib/format";
import { formatMinutes } from "@/lib/work/shared";
import type { DoneToday } from "@/lib/work/booking";
import { toast } from "./Toaster";
import { useT } from "@/components/I18nProvider";

/** One ticket's todos done today: its hours (− / + in quarters), its words — then booked, or skipped. */
function Suggestion({ s }: { s: DoneToday }) {
  const t = useT();
  const [hours, setHours] = useState(s.hours);
  const [text, setText] = useState(s.description);
  const [pending, start] = useTransition();
  const book = (skip: boolean) =>
    start(async () => {
      const r = await bookDoneTodayAction({ ticket: s.ticket, todoIds: s.todoIds, hours, description: text, skip });
      toast(r?.ok ? (r.message ?? t("Done.")) : (r?.error ?? t("Didn't work.")), { tone: r?.ok ? "ok" : "error" });
    });
  return (
    <li className="grid gap-2 py-3 sm:grid-cols-[1fr_auto]">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="font-mono font-semibold">{s.ticket}</span>
          {s.summary && <span className="text-zinc-600 dark:text-zinc-300">{s.summary}</span>}
          {s.job ? (
            <Link href={`/jobs/${s.job.id}`} className="text-xs text-zinc-500 hover:underline">
              <span className="font-mono">{s.job.number}</span> {s.job.name}
            </Link>
          ) : (
            <Link href="/jira" className="text-xs text-amber-700 hover:underline dark:text-amber-400">
              {t("no job for {ticket} — set one on the Jira tab", { ticket: s.ticket })}
            </Link>
          )}
        </div>
        <input className="input text-sm" value={text} onChange={(e) => setText(e.target.value)} aria-label={t("Description for {ticket}", { ticket: s.ticket })} />
        <div className="text-xs text-zinc-400">{s.todos.map((td) => `${td.ref} ${td.text}`).join(" · ")}</div>
        {/* What the hours add up from: the records agents and you reported, else runs' durations. */}
        {s.time.some((l) => l.kind !== "gap") && (
          <div className="text-xs text-zinc-500" title={s.time.filter((l) => l.kind !== "gap").map((l) => `${l.todo} ${formatMinutes(l.minutes)}${l.by ? ` (${l.by})` : ""}${l.note ? ` — ${l.note}` : ""}`).join("\n")}>
            {s.time
              .filter((l) => l.kind !== "gap")
              .map((l) => `${l.todo} ${formatMinutes(l.minutes)}${l.by ? ` (${l.by})` : l.kind === "hand" ? ` (${t("by hand")})` : ""}${l.related ? ` · ${t("related")}` : ""}`)
              .join(" · ")}
          </div>
        )}
        {/* A run took longer than what was reported on it: not in the hours — add it if it was work. */}
        {s.time
          .filter((l) => l.kind === "gap" && l.todoId !== undefined)
          .map((l) => (
            <div key={`gap-${l.id}`} className="flex flex-wrap items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
              <span>{t("{run} ran {n} min longer than reported on {todo}", { run: l.note, n: l.minutes, todo: l.todo })}</span>
              <button
                type="button"
                className="rounded border border-amber-300 px-1.5 py-px hover:bg-amber-50 dark:border-amber-800 dark:hover:bg-amber-950/40"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await addTodoTimeAction(l.todoId!, l.minutes, t("Unreported time of {run}", { run: l.note }));
                    toast(r?.ok ? t("Added to the hours.") : (r?.error ?? t("Didn't work.")), { tone: r?.ok ? "ok" : "error" });
                    if (r?.ok) setHours((h) => Math.min(24, Math.round((h + l.minutes / 60) * 4) / 4));
                  })
                }
              >
                {t("add {n} min", { n: l.minutes })}
              </button>
            </div>
          ))}
      </div>
      <div className="flex items-center gap-2 self-center">
        <div className="inline-flex items-center rounded-md border border-zinc-300 dark:border-zinc-700" role="group" aria-label={t("Hours for {ticket}", { ticket: s.ticket })}>
          <button type="button" className="px-2.5 py-1 text-lg leading-none disabled:opacity-40" disabled={hours <= 0.25} onClick={() => setHours(Math.max(0.25, Math.round((hours - 0.25) * 4) / 4))} aria-label={t("A quarter hour less")}>
            −
          </button>
          <span className="min-w-12 text-center font-mono text-sm font-semibold">{formatHours(hours)}</span>
          <button type="button" className="px-2.5 py-1 text-lg leading-none" onClick={() => setHours(Math.min(24, Math.round((hours + 0.25) * 4) / 4))} aria-label={t("A quarter hour more")}>
            +
          </button>
        </div>
        <button type="button" className="btn btn-sm btn-primary" disabled={pending || !s.job} onClick={() => book(false)} title={s.job ? t("Book {hours} h on {job}, today", { hours: formatHours(hours), job: s.job.number }) : t("The ticket has no job yet")}>
          {pending ? "…" : t("Add")}
        </button>
        <button type="button" className="btn btn-sm" disabled={pending} onClick={() => book(true)} title={t("Don't suggest these todos any more")}>
          {t("Skip")}
        </button>
      </div>
    </li>
  );
}

/**
 * Todos done today, by ticket, as entries to add: the time the workers took (a quarter hour for
 * each done by hand), adjustable in quarters, the words editable — added with a click.
 */
export function DoneTodayPanel({ items }: { items: DoneToday[] }) {
  const t = useT();
  if (!items.length) return null;
  return (
    <section className="card p-4">
      <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Done today")}</h2>
      <p className="text-xs text-zinc-500">{t("Todos ticked off today, by ticket — adjust the hours and the words, then add them as entries.")}</p>
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {items.map((s) => (
          <Suggestion key={s.ticket} s={s} />
        ))}
      </ul>
    </section>
  );
}
