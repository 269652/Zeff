import { detectParallel } from "@/lib/entry-parallel";
import { formatHours } from "@/lib/format";
import { t } from "@/lib/i18n/server";
import { ParallelActions } from "./ParallelControls";

/**
 * Parallel work in a period that is still booked on top of each other: two tasks of one job done at
 * the same time (their start and hours overlap). Said with what it costs (the hours added up against
 * the stretch they span) and the ways to book it: combined into one entry, the hours divided, or
 * one after the other.
 */
export function ParallelPanel({ from, to }: { from: string; to: string }) {
  const sets = detectParallel(from, to);
  if (!sets.length) return null;
  return (
    <section className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
      <h2 className="text-sm font-semibold text-amber-900 uppercase dark:text-amber-200">
        {t("Parallel work")} <span className="tabular-nums">{sets.length}</span>
      </h2>
      <p className="text-xs text-amber-900/80 dark:text-amber-200/80">{t("These were done at the same time, but are booked on top of each other. Book the stretch once — in the way that fits.")}</p>
      <ul className="space-y-3">
        {sets.map((s) => (
          <li key={s.ids.join("-")} className="space-y-1.5 rounded-lg bg-white/70 p-3 dark:bg-zinc-900/50">
            <div className="flex flex-wrap items-baseline gap-x-3 text-sm">
              <span className="font-medium">{s.label}</span>
              <span className="font-mono text-xs text-zinc-500">
                {s.date} · {s.from}–{s.to}
              </span>
              <span className="text-xs text-amber-800 dark:text-amber-300">
                {t("{sum} h booked, but the stretch is {span} h", { sum: formatHours(s.sumHours), span: formatHours(s.spanHours) })}
              </span>
            </div>
            <ul className="space-y-0.5 text-sm">
              {s.entries.map((e) => (
                <li key={e.id} className="flex flex-wrap items-baseline gap-x-3">
                  <span className="w-12 shrink-0 font-mono text-xs text-zinc-500">{e.start}</span>
                  <span className="w-14 shrink-0 text-right text-xs tabular-nums">{formatHours(e.hours)} h</span>
                  {e.ticket && <span className="font-mono text-xs text-zinc-500">{e.ticket}</span>}
                  <span className="min-w-0 flex-1 truncate">{e.description}</span>
                </li>
              ))}
            </ul>
            <ParallelActions ids={s.ids} spanHours={formatHours(s.spanHours)} sumHours={formatHours(s.sumHours)} />
          </li>
        ))}
      </ul>
    </section>
  );
}
