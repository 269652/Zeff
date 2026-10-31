"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useT } from "@/components/I18nProvider";
import type { DayPlan as Plan } from "@/lib/heute-plan";
import { applyDayPlanAction, planDayAction } from "@/plugins/todos/server-actions";

/**
 * Today's "✨ Plan my day": the AI proposes time blocks for today's todos around the appointments (one call, on the click only) —
 * shown as a proposal; Apply puts them as proposed appointments into your Zeff calendar (asked again: the day's replaced).
 */
export function DayPlan() {
  const t = useT();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [status, setStatus] = useState<{ text: string; error?: boolean; calendar?: number } | null>(null);
  const [pending, start] = useTransition();
  const ask = () =>
    start(async () => {
      setStatus(null);
      const r = await planDayAction();
      if (r.ok) setPlan(r.plan);
      else setStatus({ text: r.error, error: true });
    });
  const apply = () =>
    start(async () => {
      if (!plan) return;
      const r = await applyDayPlanAction(plan.day, plan.blocks);
      setStatus(r?.ok ? { text: r.message ?? "", calendar: r.calendarId } : { text: r?.error ?? t("Didn't work."), error: true });
    });
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={ask} disabled={pending} className="rounded-md border border-zinc-200 px-2.5 py-1 text-sm hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800">
          {pending && !plan ? t("Planning…") : plan ? t("✨ Plan again") : t("✨ Plan my day")}
        </button>
        {plan && plan.blocks.length > 0 && (
          <button type="button" onClick={apply} disabled={pending} className="rounded-md border border-indigo-300 px-2.5 py-1 text-sm text-indigo-700 hover:bg-indigo-50 disabled:opacity-60 dark:border-indigo-800 dark:text-indigo-300 dark:hover:bg-indigo-950">
            {t("Apply")}
          </button>
        )}
      </div>
      {plan && (
        <div aria-label={t("Proposed plan")} className="rounded-lg border border-dashed border-zinc-300 p-3 dark:border-zinc-700">
          {plan.note && <p className="mb-1.5 text-xs text-zinc-500">{plan.note}</p>}
          {plan.blocks.length ? (
            <ol className="space-y-1">
              {plan.blocks.map((b) => (
                <li key={b.start} className="flex items-baseline gap-2 text-sm">
                  <span className="shrink-0 font-mono text-xs text-zinc-500 tabular-nums">
                    {b.start.slice(11)}–{b.end.slice(11)}
                  </span>
                  <span className="min-w-0 flex-1">{b.title}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-zinc-500">{t("No free time left for a plan today.")}</p>
          )}
        </div>
      )}
      <p role="status" className={`text-xs ${status?.error ? "text-red-600 dark:text-red-400" : "text-zinc-500"}`}>
        {status?.text}
        {status?.calendar && (
          <Link href={`/kalender?v=day&d=${plan?.day ?? ""}`} className="ml-2 text-indigo-600 hover:underline dark:text-indigo-400">
            {t("To the calendar →")}
          </Link>
        )}
      </p>
    </div>
  );
}
