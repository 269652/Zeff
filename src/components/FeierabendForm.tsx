"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { bookDayAction, undoBookDayAction } from "@/app/actions";
import type { DayRow } from "@/lib/feierabend";
import { toast } from "./Toaster";
import { formatHours } from "@/lib/format";
import { useT } from "@/components/I18nProvider";
import type { T } from "@/lib/i18n/shared";
import { rich } from "@/lib/i18n/rich";

/** The hour figures in the sums line, bold. */
const b = (s: string) => <b className="tabular-nums">{s}</b>;

const kindLabels = (t: T): Record<DayRow["kind"], string> => ({ meeting: t("Meeting"), suggestion: t("Suggestion"), ticket: t("Ticket") });
const fmt = formatHours;

/**
 * The day's proposal to take over: each line ticked or not, its hours, job and words to change —
 * "Rest verteilen" spreads what's missing to the target over the ticket lines without hours; one
 * click books it all.
 */
export function FeierabendForm({ date, target, booked, group, rows: initial, jobs }: { date: string; target: number; booked: number; group: string | null; rows: DayRow[]; jobs: { number: string; name: string }[] }) {
  const t = useT();
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [pending, start] = useTransition();
  const set = (id: string, patch: Partial<DayRow>) => setRows((l) => l.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const chosen = rows.filter((r) => r.include);
  // A group day (a mob day: today's group entry, or a group meeting ticked here): the other lines are
  // itemized under it — real hours, but not booked on top, so they don't add to the day.
  const groupName = chosen.find((r) => r.kind === "meeting" && r.group)?.description ?? group;
  const under = (r: DayRow) => !!groupName && r.kind !== "meeting" && !r.standalone;
  const sum = chosen.filter((r) => !under(r)).reduce((s, r) => s + (r.hours ?? 0), 0);
  const itemized = chosen.filter(under).reduce((s, r) => s + (r.hours ?? 0), 0);
  const missing = Math.max(0, Math.round((target - booked - sum) * 100) / 100);
  // What's missing to the target, on the ticked ticket lines without hours — in quarter hours.
  const spread = () => {
    const open = rows.filter((r) => r.include && r.kind === "ticket" && !r.hours);
    const pool = open.length ? open : rows.filter((r) => r.include && r.kind === "ticket");
    if (!pool.length || !missing) return;
    const each = Math.max(0.25, Math.round((missing / pool.length) * 4) / 4);
    setRows((l) => l.map((r) => (pool.some((p) => p.id === r.id) ? { ...r, hours: Math.round(((open.length ? 0 : (r.hours ?? 0)) + each) * 100) / 100 } : r)));
  };
  const book = () =>
    start(async () => {
      const r = await bookDayAction(
        date,
        chosen.map((x) => ({ kind: x.kind, hours: x.hours ?? 0, jobNumber: x.jobNumber, description: x.description, ticket: x.ticket, externalId: x.externalId, suggestionId: x.suggestionId, group: x.group, start: x.start, standalone: x.standalone })),
      );
      const created = r && "created" in r ? (r.created ?? []) : [];
      toast(r?.ok ? (r.message ?? t("Booked.")) : (r?.error ?? t("Didn't work.")), {
        tone: r?.ok ? "ok" : "error",
        // What was created can be taken back (not what was changed since).
        ...(created.length
          ? {
              ms: 20000,
              action: {
                label: t("Undo"),
                run: async () => {
                  const u = await undoBookDayAction(created);
                  toast(u?.ok ? (u.message ?? t("Taken back.")) : (u?.error ?? t("Didn't work.")), { tone: u?.ok ? "ok" : "error" });
                  router.refresh();
                },
              },
            }
          : {}),
      });
      router.refresh();
    });
  // Why the book button is off (said in words, not only greyed out).
  const whyNot = !chosen.length
    ? t("Nothing ticked to book.")
    : chosen.some((r) => !r.hours)
      ? t("Every ticked row needs hours.")
      : chosen.some((r) => r.kind !== "suggestion" && !r.jobNumber)
        ? t("Every ticked row needs a job.")
        : "";

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center gap-x-6 gap-y-2 p-4 text-sm">
        <span>
          {rich(t("Booked <b>{hours}</b> h", { hours: fmt(booked) }), { b })}
        </span>
        <span>
          {rich(t("+ selected <b>{hours}</b> h", { hours: fmt(sum) }), { b })}
        </span>
        {itemized > 0 && groupName && (
          <span className="text-indigo-600 dark:text-indigo-400">
            {t("{hours} h itemized under “{group}” (not on top)", { hours: fmt(itemized), group: groupName })}
          </span>
        )}
        <span className={booked + sum >= target ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>
          {missing
            ? rich(t("= <b>{hours}</b> of {target} h — {missing} h missing", { hours: fmt(booked + sum), target: fmt(target), missing: fmt(missing) }), { b })
            : rich(t("= <b>{hours}</b> of {target} h", { hours: fmt(booked + sum), target: fmt(target) }), { b })}
        </span>
        <span className="ml-auto flex gap-2">
          <button type="button" className="btn btn-sm" disabled={pending || !missing || !rows.some((r) => r.include && r.kind === "ticket")} onClick={spread} title={t("Spread the missing hours over the ticked ticket rows without hours (in quarter hours)")}>
            {t("Spread the rest")}
          </button>
          <button type="button" className="btn btn-primary btn-sm" disabled={pending || !!whyNot} aria-describedby={whyNot ? "book-why" : undefined} onClick={book}>
            {pending ? t("Booking…") : chosen.length === 1 ? t("Book 1 row") : t("Book {n} rows", { n: chosen.length })}
          </button>
        </span>
        {whyNot && (
          <p id="book-why" className="w-full text-right text-xs text-amber-700 dark:text-amber-400">
            {whyNot}
          </p>
        )}
      </div>

      {rows.length ? (
        <ul className="card divide-y divide-zinc-100 dark:divide-zinc-800">
          {rows.map((r) => (
            <li key={r.id} className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 ${r.include ? "" : "bg-zinc-50 dark:bg-zinc-900/50"}`}>
              <input type="checkbox" className="size-4" checked={r.include} onChange={(e) => set(r.id, { include: e.target.checked })} aria-label={t("Book {description}", { description: r.description })} />
              <span className="w-20 shrink-0 text-xs text-zinc-500">{kindLabels(t)[r.kind]}</span>
              <input
                type="number"
                step={0.25}
                min={0}
                max={24}
                className="input num w-20"
                value={r.hours ?? ""}
                placeholder="h"
                aria-label={t("Hours")}
                onChange={(e) => set(r.id, { hours: e.target.value === "" ? null : Number(e.target.value) })}
              />
              {r.kind === "suggestion" ? (
                <span className="w-44 shrink-0 truncate text-xs text-zinc-500">{r.jobNumber || t("The suggestion's job")}</span>
              ) : (
                <select className="input w-44" value={r.jobNumber} aria-label={t("Job")} onChange={(e) => set(r.id, { jobNumber: e.target.value })}>
                  <option value="">{t("Pick a job…")}</option>
                  {jobs.map((j) => (
                    <option key={j.number} value={j.number}>
                      {j.number} · {j.name}
                    </option>
                  ))}
                </select>
              )}
              <input className="input min-w-0 flex-1 basis-60" value={r.description} aria-label={t("Description")} onChange={(e) => set(r.id, { description: e.target.value })} />
              <span className="flex w-full flex-wrap items-center gap-x-3 pl-[7.5rem] text-xs text-zinc-400">
                <span>
                  {r.ticket && <span className="font-mono">{r.ticket} · </span>}
                  {r.from}
                </span>
                {r.kind === "meeting" && r.group && <span className="rounded bg-indigo-100 px-1.5 py-0.5 font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">{t("Group: the day's work goes under it")}</span>}
                {r.kind !== "meeting" && groupName && (
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" className="size-3.5" checked={!r.standalone} onChange={(e) => set(r.id, { standalone: !e.target.checked })} />
                    {t("Itemize under “{group}”", { group: groupName })}
                  </label>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-6 text-center text-sm text-zinc-500">{t("Nothing to suggest — no open meetings, suggestions or tickets worked on today.")}</p>
      )}
    </div>
  );
}
