"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { bookDoneTodayAction } from "@/app/actions";
import { formatHours } from "@/lib/format";
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
