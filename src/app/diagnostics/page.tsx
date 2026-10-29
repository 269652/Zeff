import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { DiagnosticsView } from "@/components/DiagnosticsView";
import { t } from "@/lib/i18n/server";
import { formatAgo, formatFull } from "@/lib/format";
import { healthLabel, healthReason, type SourceHealth } from "@/lib/sync/source-health-shared";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Diagnostics") };
}

/** Diagnostics: something doesn't work — one report to read and send to whoever helps. */
export default async function DiagnosticsPage() {
  await connection();
  return (
    <div className="page">
      <div className="page-aside">
        <Link href="/settings" className="text-sm text-zinc-500 hover:underline">
          ← {t("Settings")}
        </Link>
        <h1 className="text-lg font-semibold">{t("Diagnostics")}</h1>
        <p className="text-sm text-zinc-500">
          {t("Something doesn't work? This collects what runs here — the programs found, the plugins, the sign-ins, how the last syncs went and the ends of the logs — into one text. Emails, tokens, passwords and your user folder are blacked out. Read it, then send it to whoever helps you. Zeff sends nothing by itself.")}
        </p>
        <Link href="/privacy" className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">
          {t("What leaves this PC")}
        </Link>
      </div>
      <div className="space-y-6">
        <SourcesHealth />
        <DiagnosticsView />
      </div>
    </div>
  );
}

const TONE: Record<SourceHealth["state"], string> = {
  ok: "bg-emerald-500",
  stale: "bg-amber-500",
  silent: "bg-amber-500",
  drift: "bg-amber-500",
  failing: "bg-red-500",
};

/** Items a day, the last 14 days, as small bars (today last). */
function PerDay({ days }: { days: number[] }) {
  const max = Math.max(1, ...days);
  return (
    <span role="img" className="inline-flex h-4 items-end gap-px" title={days.join(" · ")} aria-label={t("Items a day, the last 14 days: {list}", { list: days.join(", ") })}>
      {days.map((n, i) => (
        <span key={i} className={`w-1 rounded-sm ${n ? "bg-indigo-400 dark:bg-indigo-500" : "bg-zinc-200 dark:bg-zinc-800"}`} style={{ height: `${Math.max(2, Math.round((n / max) * 16))}px` }} />
      ))}
    </span>
  );
}

/**
 * Sources health: each sync step judged from its data — failing, its app changed, not running when it should, or silent
 * (its runs say ok but nothing new came for clearly longer than its own history says is normal).
 */
async function loadSourcesHealth(): Promise<{ health: SourceHealth[]; now: number }> {
  try {
    return { health: await (await import("@/lib/sync/source-health")).sourceHealth({ fresh: true }), now: Date.now() };
  } catch (e) {
    console.error("[diagnostics] source health", e);
    return { health: [], now: Date.now() };
  }
}

async function SourcesHealth() {
  const { health, now } = await loadSourcesHealth();
  return (
    <section id="sources" className="space-y-2">
      <h2 className="text-sm font-semibold">{t("Sources health")}</h2>
      <p className="text-xs text-zinc-500">
        {t("Judged from the data, not only from the last run: a source whose runs say ok but brings nothing new for clearly longer than its own history says is normal is silent — a site that changed. The quiet hours, and for work sources weekends and days off, don't count.")}
      </p>
      <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-900 dark:border-zinc-800">
        {health.map((h) => (
          <li key={h.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
            <span className={`size-2 shrink-0 rounded-full ${TONE[h.state]}`} aria-hidden />
            <Link href={h.href} className="w-40 shrink-0 truncate font-medium hover:underline">
              {h.label}
            </Link>
            <span className={`w-24 shrink-0 text-xs ${h.state === "ok" ? "text-zinc-500" : h.state === "failing" ? "text-red-600 dark:text-red-400" : "text-amber-700 dark:text-amber-400"}`}>{healthLabel(t, h.state)}</span>
            <span className="w-36 shrink-0 text-xs text-zinc-500" title={h.lastAt ? formatFull(h.lastAt) : undefined}>
              {h.lastAt ? t("run {ago}", { ago: formatAgo(h.lastAt, now) }) : t("never ran")}
            </span>
            <span className="w-40 shrink-0 text-xs text-zinc-500" title={h.lastNewAt ? formatFull(h.lastNewAt) : undefined}>
              {h.perDay ? (h.lastNewAt ? t("newest item {ago}", { ago: formatAgo(h.lastNewAt, now) }) : t("no items lately")) : ""}
            </span>
            {h.perDay && <PerDay days={h.perDay} />}
            {h.state !== "ok" && <span className="basis-full text-xs text-zinc-600 dark:text-zinc-400">{healthReason(t, h)}</span>}
          </li>
        ))}
        {!health.length && <li className="px-3 py-2 text-sm text-zinc-500">{t("No syncs.")}</li>}
      </ul>
    </section>
  );
}
