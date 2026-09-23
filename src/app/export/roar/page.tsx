import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { RoarExportControls } from "@/components/RoarExportControls";
import { formatHours } from "@/lib/format";
import { getRoarExportPlan } from "@/lib/roar";
import { currentWeek, formatWeekRange, resolveWeek } from "@/lib/week";

export const metadata: Metadata = { title: "Export to Roar" };

export default async function RoarExportPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; by?: string }>;
}) {
  await connection();
  const sp = await searchParams;
  const week = resolveWeek(sp.week) ?? currentWeek();
  const by = sp.by?.trim() || undefined;
  const plan = getRoarExportPlan(week, { reportedBy: by });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Export to Roar</h1>
          <p className="text-sm text-zinc-500">
            {week.key} · {formatWeekRange(week)}
            {by ? ` · ${by}` : ""} — pushed to{" "}
            <a href="https://roar.marcel.ai/app/timesheet" target="_blank" rel="noreferrer" className="hover:underline">
              roar.marcel.ai
            </a>
          </p>
        </div>
        <Link href={`/?week=${week.key}${by ? `&by=${encodeURIComponent(by)}` : ""}`} className="btn btn-sm">
          ← Back to week
        </Link>
      </div>

      <section className="card p-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-500 uppercase">What will be pushed</h2>
        {plan.rows.length === 0 ? (
          <p className="py-3 text-center text-sm text-zinc-500">Nothing booked in this week.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Job (Roar)</th>
                  {plan.days.map((d) => (
                    <th key={d.iso} className="text-right">{d.label}</th>
                  ))}
                  <th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {plan.rows.map((r) => (
                  <tr key={r.jobNumber}>
                    <td className="whitespace-nowrap">
                      <span className="font-mono">{r.jobNumber}</span> <span className="text-zinc-500">{r.jobName}</span>
                    </td>
                    {plan.days.map((d) => (
                      <td key={d.iso} className="text-right tabular-nums">
                        {r.hoursByDay[d.iso] ? formatHours(r.hoursByDay[d.iso]) : <span className="text-zinc-300 dark:text-zinc-700">·</span>}
                      </td>
                    ))}
                    <td className="text-right font-medium tabular-nums">{formatHours(r.total)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-zinc-200 font-semibold dark:border-zinc-700">
                  <td>Total</td>
                  {plan.days.map((d) => {
                    const t = plan.rows.reduce((a, r) => a + (r.hoursByDay[d.iso] ?? 0), 0);
                    return (
                      <td key={d.iso} className="text-right tabular-nums">{t ? formatHours(t) : ""}</td>
                    );
                  })}
                  <td className="text-right tabular-nums">{formatHours(plan.total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-zinc-400">
          Roar&apos;s timesheet is a job × day grid, so entries are summed per job per day; descriptions and tickets
          aren&apos;t transferred. Jobs are matched to Roar by their number (e.g. <code className="code">AB123-000001-00</code>).
        </p>
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase">Transfer</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-zinc-600 dark:text-zinc-300">
          <li>
            Once: run <code className="code">npm run roar:chrome</code> and sign in to Roar in that Chrome window
            (the session is saved).
          </li>
          <li><strong>Check Roar connection</strong> to confirm the automation can attach.</li>
          <li>
            <strong>Dry run</strong> verifies every job resolves in Roar. Then <strong>Fill in Roar</strong> enters the
            hours — it stops there so you review and save in the Roar window (it never submits for you).
          </li>
        </ol>
        {plan.rows.length > 0 && <RoarExportControls week={week.key} by={by} />}
      </section>
    </div>
  );
}
