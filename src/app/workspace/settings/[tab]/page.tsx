import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { sourcesOverview } from "@/plugins/workspace/sources";
import { SourcesView } from "@/plugins/workspace/ui/Sources";
import { OutputsView } from "@/plugins/workspace/ui/Outputs";

const TABS = ["sources", "outputs", "prompts", "apps"] as const;
type Tab = (typeof TABS)[number];
const isTab = (v: string): v is Tab => (TABS as readonly string[]).includes(v);

const label = (tab: Tab) => ({ sources: t("Data sources"), outputs: t("Outputs"), prompts: t("Prompts"), apps: t("Apps") })[tab];
const ICON: Record<Tab, string> = { sources: "🔌", outputs: "📤", prompts: "💬", apps: "◫" };

export async function generateMetadata({ params }: { params: Promise<{ tab: string }> }): Promise<Metadata> {
  const { tab } = await params;
  return { title: `${t("Workspace settings")}${isTab(tab) ? ` · ${label(tab)}` : ""}` };
}

/**
 * The Workspace's settings — a sidebar of their own: where its databases' rows come from (data sources), what goes out of
 * them (outputs: into the Ticket-Lage; the knowledge server picks for itself), its prompts (System → Prompts), the apps that
 * show its databases (mail client, chat).
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
    const dbs = listCollections({ plugin: "workspace" }).map((c) => ({ id: Number(c.id.slice("workspace:".length)), name: c.name, briefing: !!c.briefing, source: c.source ?? null }));
    return <OutputsView databases={dbs} knowledgeOn={isInstalled("knowledge")} />;
  }
  if (tab === "prompts") {
    const { ensureSystemPrompts, systemPrompts, PROMPT_GROUPS } = await import("@/lib/prompts");
    await ensureSystemPrompts();
    const prompts = await systemPrompts();
    return (
      <div className="space-y-4">
        <p className="text-sm text-zinc-500">{t("Every prompt is a page of the Workspace (System → Prompts): change it there like any page — it stays, and goes back to the built-in text with a click.")}</p>
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {PROMPT_GROUPS.map((g) => {
            const list = prompts.filter((x) => x.group === g && x.pageId);
            if (!list.length) return null;
            return (
              <section key={g} className="card space-y-1 p-3">
                <h2 className="text-xs font-semibold text-zinc-500 uppercase">{t(g)}</h2>
                <ul className="space-y-0.5 text-sm">
                  {list.map((x) => (
                    <li key={x.key}>
                      <Link href={`/workspace/${x.pageId}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                        📝 {t(x.title)}
                      </Link>
                      {x.modified && <span className="ml-1.5 rounded bg-amber-100 px-1 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">{t("changed")}</span>}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
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
