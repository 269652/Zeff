import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { isInstalled } from "@/plugins/state";
import type { Metadata } from "next";
import Link from "next/link";
import { t } from "@/lib/i18n/server";
import { headers } from "next/headers";
import { connection } from "next/server";
import { GitlabConnection } from "@/plugins/gitlab/GitlabConnection";
import { apiConnected, getConnector } from "@/lib/connectors/store";
import { saveGitlabSyncAction, syncGitlabAction } from "@/plugins/gitlab/server-actions";
import { GitlabItemList } from "@/components/GitlabItemList";
import { SyncControls } from "@/components/SyncControls";
import { getGitlabSettings, gitlabItemCounts, listGitlabItems } from "@/lib/gitlab/store";
import type { GitlabKind } from "@/lib/gitlab/shared";
import { agoText } from "@/lib/teams/time";
import { getEntryTicketSuggestions } from "@/lib/ticket-suggestions";
import { currentWeek } from "@/lib/week";

export const metadata: Metadata = { title: "GitLab" };

export default async function GitlabPage({ searchParams }: { searchParams: Promise<{ q?: string; kind?: string; error?: string; connected?: string }> }) {
  await connection();
  const h = await headers();
  const hostHeader = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const proto = h.get("x-forwarded-proto")?.split(",")[0] ?? "http";
  const connector = getConnector("gitlab");
  // A plugin's page: there while it's installed.
  if (!isInstalled("gitlab")) return <PluginNotInstalled id="gitlab" />;
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const kind: GitlabKind | undefined = sp.kind === "mr" || sp.kind === "comment" || sp.kind === "branch" ? sp.kind : undefined;
  const settings = getGitlabSettings();
  const counts = gitlabItemCounts();
  const items = listGitlabItems({ q, kind, limit: 150 });
  // Jira keys in titles and branch names count when their prefix is one you book.
  const ticketPrefixes = [...new Set(getEntryTicketSuggestions(currentWeek()).map((s) => s.ticket.split("-")[0].toUpperCase()))];
  const href = (k?: GitlabKind) => `/gitlab?${new URLSearchParams({ ...(k ? { kind: k } : {}), ...(q ? { q } : {}) })}`;
  const tabs: { kind?: GitlabKind; label: string; n: number }[] = [
    { label: t("All"), n: counts.all },
    { kind: "mr", label: t("Merge requests"), n: counts.mr },
    { kind: "comment", label: t("Comments"), n: counts.comment },
    { kind: "branch", label: t("Branches"), n: counts.branch },
  ];
  const host = (() => {
    try {
      return new URL(settings.baseUrl).host;
    } catch {
      return settings.baseUrl;
    }
  })();

  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">GitLab</h1>
        <p className="text-sm text-zinc-500">
          {connector.driver === "api"
            ? t(
                "Merge requests you wrote, are assigned to or review, their comments (yours too), and your branches — read from {host} through its API. Add them to an entry with its context search (a pasted link works too), or add one as context here.",
                { host },
              )
            : t(
                "Merge requests you wrote, are assigned to or review, their comments (yours too), and your branches — read from {host} in the automation Chrome (GET requests only: nothing changes in GitLab). Add them to an entry with its context search (a pasted link works too), or add one as context here.",
                { host },
              )}
        </p>
      </div>

      <GitlabConnection
        error={sp.error === "client" ? t("Set your OAuth application first.") : (sp.error ?? null)}
        justConnected={sp.connected === "1"}
        redirectUri={`${proto}://${hostHeader}/api/connectors/gitlab/callback`}
        s={{
          driver: connector.driver === "api" ? "api" : "cdp",
          authKind: connector.authKind === "oauth" ? "oauth" : "token",
          hasToken: !!connector.token,
          clientId: connector.clientId,
          hasSecret: !!connector.clientSecret,
          connected: apiConnected(connector),
          account: connector.account,
          host,
        }}
      />

      <section className="card p-4">
        <SyncControls
          syncKey="gitlab"
          sync={syncGitlabAction}
          save={saveGitlabSyncAction}
          baseUrl={settings.baseUrl}
          syncMinutes={settings.syncMinutes}
          last={settings.lastSyncAt ? { at: settings.lastSyncAt, ago: agoText(settings.lastSyncAt), ok: !!settings.lastOk, result: settings.lastResult ?? "" } : null}
        />
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex rounded-md border border-zinc-200 p-0.5 text-sm dark:border-zinc-700" aria-label={t("Kind")}>
          {tabs.map((tab) => (
            <Link
              key={tab.label}
              href={href(tab.kind)}
              aria-current={kind === tab.kind ? "page" : undefined}
              className={`rounded px-3 py-1 ${kind === tab.kind ? "bg-zinc-200 font-medium dark:bg-zinc-700" : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`}
            >
              {tab.label} <span className="text-xs text-zinc-400">{tab.n}</span>
            </Link>
          ))}
        </nav>
        <form action="/gitlab" className="flex min-w-64 flex-1 justify-end gap-2 sm:max-w-md">
          {kind && <input type="hidden" name="kind" value={kind} />}
          <input name="q" defaultValue={q} className="input" placeholder={t("Search !169, title, words, branch, author…")} aria-label={t("Search GitLab items")} />
          <button type="submit" className="btn">{t("Search")}</button>
        </form>
      </div>

      {items.length ? (
        <GitlabItemList items={items} ticketPrefixes={ticketPrefixes} />
      ) : (
        <p className="py-6 text-center text-sm text-zinc-500">
          {counts.all ? t("Nothing matches.") : t("Nothing synced yet — press Sync now ({host} opens in the automation Chrome if it isn't).", { host })}
        </p>
      )}
      {items.length === 150 && <p className="text-center text-xs text-zinc-400">{t("The latest 150 — search to find older ones.")}</p>}
    </div>
  );
}
