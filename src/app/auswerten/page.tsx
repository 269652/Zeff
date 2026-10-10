import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { ContextStepForm } from "@/components/ContextStepForm";
import { getContextPrefs } from "@/lib/boards/context-prefs";
import { CONTEXT_STEPS } from "@/lib/boards/context-prefs-shared";
import { installedPlugins } from "@/plugins/state";

export const metadata: Metadata = { title: "Auswerten" };

/**
 * Auswerten: what each AI step of the evaluation reads — the Ticket-Lage, the review of mails and
 * messages, the assignment, the auto-actions, the reply drafts: their sources, how far back, how
 * much, and instructions of your own. Steps and sources of plugins that aren't installed don't show.
 */
export default async function AuswertenPage() {
  await connection();
  const on = installedPlugins();
  const prefs = getContextPrefs();
  const steps = CONTEXT_STEPS.filter((s) => !s.plugin || on.has(s.plugin));
  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">Auswerten</h1>
        <p className="text-sm text-zinc-500">
          Was die KI bei jedem Schritt der Auswertung liest: welche Quellen, wie weit zurück, wie viel — und was du ihr für den Schritt mitgibst. Eine Quelle aus: sie geht nicht in die KI (bei der
          Durchsicht bleiben ihre Nachrichten liegen, bis du sie wieder einschaltest).
        </p>
        <p className="text-sm text-zinc-500">
          Wer du bist und was immer gilt:{" "}
          <Link href="/llm" className="text-indigo-600 hover:underline dark:text-indigo-400">
            LLM
          </Link>
          . Wie oft es läuft:{" "}
          <Link href="/sync-settings" className="text-indigo-600 hover:underline dark:text-indigo-400">
            Sync-Einstellungen
          </Link>
          .
        </p>
        <nav className="flex flex-col gap-0.5 text-sm" aria-label="Schritte">
          {steps.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="rounded px-2 py-1 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">
              {s.label}
            </a>
          ))}
        </nav>
      </div>
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
