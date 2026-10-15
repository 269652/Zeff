import type { Metadata } from "next";
import { t } from "@/lib/i18n/server";
import { rich } from "@/lib/i18n/rich";
import Link from "next/link";
import { connection } from "next/server";
import { ContextStepForm } from "@/components/ContextStepForm";
import { aiQuality, STALE_DAYS, type AiQuality } from "@/lib/ai-quality";
import { getContextPrefs } from "@/lib/boards/context-prefs";
import { contextSteps } from "@/lib/boards/context-prefs-shared";
import { installedPlugins } from "@/plugins/state";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("AI steps") };
}

/**
 * Auswerten: what each AI step of the evaluation reads — the Ticket-Lage, the review of mails and
 * messages, the assignment, the auto-actions, the reply drafts: their sources, how far back, how
 * much, and instructions of your own. Steps and sources of plugins that aren't installed don't show.
 */
export default async function AuswertenPage({ searchParams }: { searchParams: Promise<{ zeit?: string }> }) {
  await connection();
  const on = installedPlugins();
  const prefs = getContextPrefs();
  const steps = contextSteps(t).filter((s) => !s.plugin || on.has(s.plugin));
  const all = (await searchParams).zeit === "alle";
  const quality = aiQuality(all ? null : 30);
  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">{t("AI steps")}</h1>
        <p className="text-sm text-zinc-500">
          {t(
            "What the AI reads at each step: which sources, how far back, how much — and what you give it for the step. A source turned off doesn't go into the AI (in the reviews its messages wait until you turn it back on).",
          )}
        </p>
        <p className="text-sm text-zinc-500">
          {rich(t("Who you are and what always applies: <llm>LLM</llm>. How often it runs: <sync>Sync settings</sync>."), {
            llm: (s) => (
              <Link href="/llm" className="text-indigo-600 hover:underline dark:text-indigo-400">
                {s}
              </Link>
            ),
            sync: (s) => (
              <Link href="/sync-settings" className="text-indigo-600 hover:underline dark:text-indigo-400">
                {s}
              </Link>
            ),
          })}
        </p>
        <nav className="flex flex-col gap-0.5 text-sm" aria-label={t("Steps")}>
          <a href="#qualitaet" className="rounded px-2 py-1 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">
            {t("How well it did")}
          </a>
          {steps.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="rounded px-2 py-1 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">
              {s.label}
            </a>
          ))}
        </nav>
      </div>
      <Quality q={quality} all={all} />
      {steps.map((s) => (
        <section key={s.id} id={s.id} className="card scroll-mt-4 space-y-3 p-4">
          <div>
            <h2 className="font-medium">{s.label}</h2>
            <p className="text-sm text-zinc-500">{s.what}</p>
          </div>
          <ContextStepForm step={s} prefs={prefs[s.id]} installed={[...on]} />
        </section>
      ))}
    </div>
  );
}

const pct = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)} %`);
const days = (x: number | null) => (x === null ? "–" : x < 1 ? t("< 1 day") : t("{n} days", { n: x.toFixed(1) }));

/** How well the steps did: what became of the todos each made — and what was proposed again after you dropped it. */
function Quality({ q, all }: { q: AiQuality; all: boolean }) {
  const tab = (on: boolean) => `rounded px-2 py-0.5 ${on ? "bg-zinc-200 font-medium dark:bg-zinc-700" : "text-indigo-600 hover:underline dark:text-indigo-400"}`;
  return (
    <section id="qualitaet" className="card scroll-mt-4 space-y-3 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-medium">{t("How well it did")}</h2>
          <p className="text-sm text-zinc-500">
            {rich(
              t(
                "What became of each step's todos. What you dismiss, you didn't want: the <em>hit rate</em> is done ÷ (done + dismissed by you). Todos the AI withdrew itself (outdated, another way) don't count against it.",
              ),
              { em: (s) => <em>{s}</em> },
            )}
          </p>
        </div>
        <div className="flex gap-1 text-sm">
          <a href="?zeit=30#qualitaet" className={tab(!all)}>
            {t("30 days")}
          </a>
          <a href="?zeit=alle#qualitaet" className={tab(all)}>
            {t("All")}
          </a>
        </div>
      </div>
      {q.rows.length ? (
        <div className="overflow-x-auto">
          <table className="table text-sm">
            <thead>
              <tr className="text-left text-xs text-zinc-500">
                <th scope="col">{t("Step")}</th>
                <th scope="col" className="text-right">{t("New")}</th>
                <th scope="col" className="text-right">{t("Done")}</th>
                <th scope="col" className="text-right" title={t("Dismissed by you")}>
                  {t("Dismissed")}
                </th>
                <th scope="col" className="text-right" title={t("Withdrawn by the AI (outdated) or done another way")}>
                  {t("Withdrawn")}
                </th>
                <th scope="col" className="text-right" title={t("Reopened by you — closed too early")}>
                  {t("Reopened")}
                </th>
                <th scope="col" className="text-right" title={t("In brackets: untouched for {n} days", { n: STALE_DAYS })}>
                  {t("Open")}
                </th>
                <th scope="col" className="text-right">{t("Hit rate")}</th>
                <th scope="col" className="text-right" title={t("Median: created to done")}>
                  {t("To done")}
                </th>
              </tr>
            </thead>
            <tbody>
              {q.rows.map((r) => (
                <tr key={r.origin} className={r.origin === "auto-actions" ? "border-t border-zinc-200 dark:border-zinc-800" : ""}>
                  <td className="whitespace-nowrap">{r.label}</td>
                  <td className="text-right tabular-nums">{r.created}</td>
                  <td className="text-right tabular-nums">{r.done}</td>
                  <td className={`text-right tabular-nums ${r.dismissedByYou ? "text-red-600 dark:text-red-400" : ""}`}>{r.dismissedByYou}</td>
                  <td className="text-right text-zinc-500 tabular-nums">{r.withdrawn}</td>
                  <td className="text-right tabular-nums">{r.reopenedByYou}</td>
                  <td className="text-right tabular-nums">
                    {r.open}
                    {r.stale ? <span className="text-amber-600 dark:text-amber-400"> ({r.stale})</span> : null}
                  </td>
                  <td className={`text-right font-medium tabular-nums ${r.hitRate !== null && r.hitRate < 0.5 ? "text-red-600 dark:text-red-400" : ""}`}>{pct(r.hitRate)}</td>
                  <td className="text-right text-zinc-500 tabular-nums">{days(r.medianDaysToDone)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-zinc-400">{all ? t("No todos yet.") : t("No new todos in the last 30 days.")}</p>
      )}
      {q.repeats.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-sm font-medium">{t("Suggested again after you dismissed it")}</h3>
          <ul className="space-y-1 text-sm">
            {q.repeats.slice(0, 10).map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline gap-x-2">
                <Link href={`/t/${r.id}`} className="font-mono text-xs text-zinc-400 hover:underline">
                  {r.ref}
                </Link>
                <span className="min-w-0 flex-1">{r.text}</span>
                <span className="text-xs text-zinc-500">
                  {rich(t("like <link>{ref}</link>", { ref: r.like.ref }), {
                    link: (s) => (
                      <Link href={`/t/${r.like.id}`} className="font-mono hover:underline">
                        {s}
                      </Link>
                    ),
                  })}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-zinc-500">
            {t("The mail review and the note review no longer create these: what you dismissed in the last 60 days counts as already there for them.")}
          </p>
        </div>
      )}
    </section>
  );
}
