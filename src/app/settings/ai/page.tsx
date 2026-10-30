import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { LlmSections } from "./LlmSections";
import { PromptsSections, promptSteps } from "./PromptsSections";
import { QualitySections } from "./QualitySections";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("AI settings") };
}

/**
 * The AI settings, one page: the backends and models, your instructions and the tasks (the LLM plugin; was /llm), the prompts
 * and what each step reads (was /settings/prompts), and how useful each step is (was /settings/ai-quality). The old
 * addresses lead to their section here.
 */
export default async function AiSettingsPage({ searchParams }: { searchParams: Promise<{ zeit?: string; todo?: string; error?: string }> }) {
  await connection();
  const sp = await searchParams;
  const toc: [string, string][] = [
    ["backends", t("Backends")],
    ...(isInstalled("llm") ? ([["instructions", t("Instructions, context & tasks")]] as [string, string][]) : []),
    ["prompts", t("The prompts")],
    ["qualitaet", t("How well it did")],
    ...promptSteps().map((s) => [s.id, s.label] as [string, string]),
    ["ai-quality", t("AI quality")],
  ];
  return (
    <div className="page">
      <div className="page-aside">
        <Link href="/settings" className="text-sm text-zinc-500 hover:underline">
          ← {t("Settings")}
        </Link>
        <h1 className="text-lg font-semibold">{t("AI")}</h1>
        <p className="text-sm text-zinc-500">
          {t("The AI layer: the briefing, recap, mail steps, auto actions and the workers all run through it. Backends are the installed CLI plugins (Menu → Plugins).")}
        </p>
        <nav className="flex flex-col gap-0.5 text-sm" aria-label={t("Sections")}>
          {toc.map(([id, label]) => (
            <a key={id} href={`#${id}`} className="rounded px-2 py-1 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">
              {label}
            </a>
          ))}
        </nav>
      </div>
      <LlmSections />
      <PromptsSections sp={sp} />
      <h2 className="pt-2 text-sm font-semibold text-zinc-500 uppercase">{t("AI quality")}</h2>
      <QualitySections />
    </div>
  );
}
