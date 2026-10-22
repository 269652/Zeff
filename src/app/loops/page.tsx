import type { Metadata } from "next";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { LOOP_VIEWS, type LoopView } from "@/plugins/loops/shared";
import { LoopsList } from "@/plugins/loops/ui/LoopsList";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Open loops") };
}

/**
 * Open loops: what you promised and what was promised to you, the questions and requests waiting for you, your questions waiting
 * for an answer — by view (what I owe, what I'm owed, overdue, closed lately), each with your word on it.
 */
export default async function LoopsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  await connection();
  if (!isInstalled("loops")) return <PluginNotInstalled id="loops" />;
  const sp = await searchParams;
  const view = (LOOP_VIEWS as readonly string[]).includes(sp.view ?? "") ? (sp.view as LoopView) : "all";
  return (
    <div className="page">
      <div className="page-aside space-y-2">
        <h1 className="text-lg font-semibold">{t("Open loops")}</h1>
        <p className="text-sm text-zinc-500">{t("What is still open between you and others: what you promised, what was promised to you, questions and review or signature requests nobody answered, your questions without an answer, Jira comments addressed to you.")}</p>
        <p className="text-xs text-zinc-400">{t("Promises are read from your messages by the AI (with the People step after the briefing); questions, requests and mentions by rule. A loop closes when its source shows it (an attachment sent, the ticket done) — a reply about it is proposed for you to confirm — or when you close it.")}</p>
      </div>
      <div>
        <LoopsList key={view} initialView={view} />
      </div>
    </div>
  );
}
