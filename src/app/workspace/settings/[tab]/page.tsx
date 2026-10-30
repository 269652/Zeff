import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { sourcesOverview } from "@/plugins/workspace/sources";
import { SourcesView } from "@/plugins/workspace/ui/Sources";
import { OutputsView } from "@/plugins/workspace/ui/Outputs";

const TABS = ["sources", "outputs", "pipelines", "history", "apps"] as const;
type Tab = (typeof TABS)[number];
const isTab = (v: string): v is Tab => (TABS as readonly string[]).includes(v);

const label = (tab: Tab) => ({ sources: t("Data sources"), outputs: t("Outputs"), pipelines: t("Pipelines"), history: t("History"), apps: t("Apps") })[tab];
const ICON: Record<Tab, string> = { sources: "🔌", outputs: "📤", pipelines: "⛓", history: "↩", apps: "◫" };

export async function generateMetadata({ params }: { params: Promise<{ tab: string }> }): Promise<Metadata> {
  const { tab } = await params;
  return { title: `${t("Workspace settings")}${isTab(tab) ? ` · ${label(tab)}` : ""}` };
}

/**
 * The Workspace's settings — a sidebar of their own: where its databases' rows come from (data sources), what goes out of
 * them (outputs: into the Ticket-Lage; the knowledge server picks for itself), the apps that show its databases (mail client,
 * chat). Its prompts are on the AI settings page (/settings/ai#prompts) — the old prompts tab leads there (next.config.ts).
 */
export default async function WorkspaceSettingsPage({ params }: { params: Promise<{ tab: string }> }) {
  await connection();
  if (!isInstalled("workspace")) return null;
  const { tab } = await params;
  if (!isTab(tab)) notFound();
  return (
    <div className="grid gap-6 md:grid-cols-[13rem_minmax(0,1fr)]">
      <nav className="space-y-0.5" aria-label={t("Workspace settings")}>
        <h1 className="mb-2 text-lg font-semibold">{t("Workspace settings")}</h1>
        {TABS.map((x) => (
          <Link
            key={x}
            href={`/workspace/settings/${x}`}
            aria-current={x === tab ? "page" : undefined}
            className={`block rounded-md px-2 py-1.5 text-sm ${x === tab ? "bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}
          >
            <span aria-hidden className="mr-1.5">{ICON[x]}</span>
            {label(x)}
          </Link>
        ))}
      </nav>
      <div className="min-w-0">{await body(tab)}</div>
    </div>
  );
}

async function body(tab: Tab) {
  if (tab === "sources") return <SourcesView sources={sourcesOverview()} />;
  if (tab === "outputs") {
    const { listCollections } = await import("@/lib/items");
    const { hasOwnLabel } = await import("@/plugins/workspace/sensitivity");
    const dbs = listCollections({ plugin: "workspace" }).map((c) => ({ id: Number(c.id.slice("workspace:".length)), name: c.name, briefing: !!c.briefing, source: c.source ?? null, sensitivity: c.sensitivity ?? "open", own: hasOwnLabel(Number(c.id.slice("workspace:".length))) }));
    return <OutputsView databases={dbs} knowledgeOn={isInstalled("knowledge")} />;
  }
  if (tab === "pipelines") {
    const { allPipelineRuns, afterSyncPlan } = await import("@/plugins/workspace/pipeline");
    const { getDatabase } = await import("@/plugins/workspace/store");
    const { RunLine } = await import("@/plugins/workspace/ui/RunLog");
    const runs = allPipelineRuns(7);
    const ids = [...new Set([...afterSyncPlan().map((x) => x.id), ...runs.map((r) => r.dbId)])];
    return (
      <div className="space-y-3">
        <p className="text-sm text-zinc-500">{t("Every pipeline, what it did in the last 7 days — and what its AI cost.")}</p>
        <ul className="card divide-y divide-zinc-100 dark:divide-zinc-800">
          {ids.map((id) => {
            const db = getDatabase(id);
            if (!db || db.page.archivedAt) return null;
            const mine = runs.filter((r) => r.dbId === id);
            const cost = mine.reduce((n, r) => n + r.costUsd, 0);
            const calls = mine.reduce((n, r) => n + r.aiCalls, 0);
            const pl = db.schema.pipeline;
            return (
              <li key={id} className="space-y-0.5 px-3 py-2 text-sm">
                <div className="flex items-center gap-2">
                  <Link href={`/workspace/${id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                    {db.page.icon || "⛓"} {db.page.title || t("Untitled")}
                  </Link>
                  <span className="text-xs text-zinc-500">
                    {pl?.autoAi ? `${t("AI after each sync")} · ` : ""}
                    {pl?.everyMinutes ? `${t("every {n} min", { n: pl.everyMinutes })} · ` : ""}
                    {mine.length} {t("runs")} · {calls} {t("AI calls")}
                    {cost > 0 ? ` · $${cost.toFixed(2)}` : ""}
                  </span>
                </div>
                {mine[0] && (
                  <div className="text-xs text-zinc-500">
                    <RunLine r={mine[0]} />
                  </div>
                )}
              </li>
            );
          })}
          {!ids.length && <li className="px-3 py-3 text-sm text-zinc-500">{t("No pipelines yet.")}</li>}
        </ul>
      </div>
    );
  }
  if (tab === "history") {
    const { HistoryList } = await import("@/plugins/workspace/ui/history");
    return (
      <div className="space-y-3">
        <p className="text-sm text-zinc-500">{t("What the AI, the automations and bulk edits did — each as one entry you can take back. Kept for 30 days (the last 40).")}</p>
        <HistoryList />
      </div>
    );
  }
  const { APP_VIEWS } = await import("@/plugins/workspace/app-views");
  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-500">{t("Apps show databases of their type their way — a view like any of the database's. Without its plugin, such a database is a table.")}</p>
      <ul className="grid gap-3 sm:grid-cols-2">
        {APP_VIEWS.map((a) => (
          <li key={a.id} className="card space-y-1 p-3">
            <p className="font-medium">
              {a.icon} {t(a.label)}
            </p>
            <p className="text-sm text-zinc-500">{a.dataType === "mail" ? t("For databases of mails (Outlook, Gmail).") : t("For databases of messages (Teams, WhatsApp, Signal).")}</p>
            <p className="text-xs">
              {isInstalled(a.plugin) ? (
                <span className="text-emerald-700 dark:text-emerald-400">✓ {t("installed")}</span>
              ) : (
                <Link href="/plugins" className="text-indigo-600 hover:underline dark:text-indigo-400">
                  {t("Install it (Menu → Plugins)")}
                </Link>
              )}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
