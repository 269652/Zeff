import Link from "next/link";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import type { WidgetTile } from "@/plugins/workspace/widget-point";

const TONE_TEXT: Record<NonNullable<WidgetTile["tone"]>, string> = {
  good: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  bad: "text-red-600 dark:text-red-400",
};

/**
 * Today's Kennzahlen strip: the ones you marked "Show on Today" on the Kennzahlen page (Workspace → Metrics), each with its
 * value now and its unit — a click leads to it there. Nothing marked: nothing shown. Server component.
 */
export async function TodayMetrics() {
  if (!isInstalled("workspace")) return null;
  let tiles: (WidgetTile & { key: string })[] = [];
  try {
    const { todayMetrics } = await import("@/plugins/workspace/metrics");
    const { metricTile } = await import("@/plugins/workspace/widgets-metrics");
    tiles = await Promise.all(todayMetrics().map(async (m) => ({ key: m.key, ...(await metricTile(m)) })));
  } catch {
    return null; // (a Kennzahl that can't be read doesn't take Today down)
  }
  if (!tiles.length) return null;
  return (
    <section aria-labelledby="metrics-h" id="metrics" className="scroll-mt-4">
      <h2 id="metrics-h" className="mb-1.5 flex items-baseline justify-between gap-2 text-sm font-semibold text-zinc-500 uppercase">
        {t("Metrics")}
        <Link href="/workspace/metrics" className="text-xs font-normal tracking-normal text-indigo-600 normal-case hover:underline dark:text-indigo-400">
          {t("all →")}
        </Link>
      </h2>
      <ul className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(9rem,1fr))]">
        {tiles.map((x) => (
          <li key={x.key}>
            <Link href={x.href ?? "/workspace/metrics"} title={x.detail} className="block min-w-0 rounded-xl border border-zinc-200 px-3 py-2 text-inherit no-underline hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900">
              <span className={`block truncate text-xs ${x.tone ? TONE_TEXT[x.tone] : "text-zinc-500"}`}>{x.label}</span>
              <span className="block truncate text-lg leading-tight font-semibold tabular-nums">{x.value}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
