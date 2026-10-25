"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { regenerateRecurringAction, setTodoDueAction, setTodoRecurrenceAction } from "@/plugins/todos/server-actions";
import { DateField } from "@/components/DateField";
import { duePill, dueText } from "@/lib/boards/due-shared";
import { formatDate } from "@/lib/format";
import { toast } from "../Toaster";
import { useT } from "@/components/I18nProvider";

/**
 * A todo's deadline in its line: when it's due (red when today or past, amber within three days)
 * — set, changed or taken away by a click (a date field). Without one, a quiet "Frist" on hover.
 */
export function DueBadge({ todoId, due, closed }: { todoId: number; due: string | null; closed: boolean }) {
  const t = useT();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const save = (v: string | null) =>
    start(async () => {
      const r = await setTodoDueAction(todoId, v);
      if (!r?.ok) toast(r?.error ?? t("Didn't work."), { tone: "error" });
      setEditing(false);
      router.refresh();
    });
  if (closed && !due) return null;
  if (editing)
    return (
      <span className="inline-flex items-center gap-1">
        {" · "}
        {/* (Picked in the calendar: saved at once; typed: on Enter or leaving the field — see DateField.) */}
        <DateField
          className="rounded border border-zinc-300 px-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
          value={due}
          autoFocus
          disabled={pending}
          aria-label={t("Due date")}
          onCommit={save}
          onCancel={() => setEditing(false)}
          onBlur={() => setEditing(false)}
        />
        {due && (
          <button type="button" className="hover:text-zinc-700 hover:underline" onMouseDown={(e) => e.preventDefault()} onClick={() => save(null)}>
            {t("no due date")}
          </button>
        )}
      </span>
    );
  return due ? (
    <button type="button" className={`ml-0.5 rounded-full px-2 py-px font-medium ring-1 ring-inset ${closed ? "bg-transparent text-zinc-400 ring-zinc-200 dark:ring-zinc-700" : `${duePill(due)} hover:brightness-95`}`} onClick={() => !closed && setEditing(true)} title={t("Due: {date} — change", { date: formatDate(due, { year: true }) })}>
      {dueText(due, t)}
    </button>
  ) : (
    <button type="button" className="ml-0.5 rounded-full px-2 py-px text-zinc-400 opacity-0 ring-1 ring-zinc-200 ring-inset transition group-hover:opacity-100 hover:text-zinc-600 focus:opacity-100 dark:ring-zinc-700" onClick={() => setEditing(true)} title={t("Set a due date")}>
      + {t("due date")}
    </button>
  );
}

const FREQS = ["daily", "weekly", "monthly", "yearly"] as const;

/**
 * A todo that comes back (a rate on the 15th of every month): "↻ monthly" with a little calendar that leads to its series in the calendar;
 * a choice on hover sets it (every day, week, month, year) or takes it away. The rule follows the due day.
 */
export function RepeatBadge({ todoId, rule, due, closed }: { todoId: number; rule: { freq: (typeof FREQS)[number]; interval: number } | null; due: string | null; closed: boolean }) {
  const t = useT();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const names = { daily: t("every day"), weekly: t("every week"), monthly: t("every month"), yearly: t("every year") };
  const save = (v: (typeof FREQS)[number] | null) =>
    start(async () => {
      const r = await setTodoRecurrenceAction(todoId, v);
      if (!r?.ok) toast(r?.error ?? t("Didn't work."), { tone: "error" });
      setEditing(false);
      router.refresh();
    });
  if (editing)
    return (
      <span className="inline-flex items-center gap-1">
        {" · "}
        <select
          className="rounded border border-zinc-300 px-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
          autoFocus
          disabled={pending}
          aria-label={t("Repeat")}
          value={rule?.freq ?? ""}
          onChange={(e) => save((e.target.value || null) as (typeof FREQS)[number] | null)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
        >
          <option value="">{t("does not repeat")}</option>
          {FREQS.map((f) => (
            <option key={f} value={f}>
              {names[f]}
            </option>
          ))}
        </select>
      </span>
    );
  if (rule)
    return (
      <>
        {" · "}
        <button type="button" className="hover:underline" onClick={() => !closed && setEditing(true)} title={t("Comes back {when} — change", { when: names[rule.freq] })}>
          ↻ {names[rule.freq]}
        </button>
        {due && (
          // eslint-disable-next-line @next/next/no-html-link-for-pages -- a redirect to the calendar's day
          <a href={`/api/todos/${todoId}/calendar`} className="ml-1 no-underline" title={t("Show it in the calendar")} aria-label={t("Show it in the calendar")}>
            📅
          </a>
        )}
        {!closed && (
          <button type="button" className="ml-1 opacity-0 transition group-hover:opacity-100 hover:text-zinc-600 hover:underline focus:opacity-100" disabled={pending} title={t("Make the calendar appointments and the actions again")} onClick={() => start(async () => { const r = await regenerateRecurringAction(todoId); toast(r?.ok ? (r.message ?? t("Done.")) : (r?.error ?? t("Didn't work.")), { tone: r?.ok ? "ok" : "error" }); router.refresh(); })}>
            {t("make again")}
          </button>
        )}
      </>
    );
  if (closed) return null;
  return (
    <button type="button" className="opacity-0 transition group-hover:opacity-100 hover:text-zinc-600 hover:underline focus:opacity-100" onClick={() => setEditing(true)} title={t("Make it come back")}>
      {" · "}{t("repeat")}
    </button>
  );
}
