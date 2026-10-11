import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { isInstalled } from "@/plugins/state";
import type { Metadata } from "next";
import Link from "next/link";
import { t } from "@/lib/i18n/server";
import { connection } from "next/server";
import { TeamsMessageList } from "@/components/TeamsMessageList";
import { syncTeamsAction } from "@/plugins/teams/server-actions";
import { SyncControls } from "@/components/SyncControls";
import { getTeamsSettings, listTeamsMessages, teamsMessageCounts } from "@/lib/teams/store";
import { agoText } from "@/lib/teams/time";
import type { TeamsKind } from "@/lib/teams/shared";

export const metadata: Metadata = { title: "Teams" };

export default async function TeamsPage({ searchParams }: { searchParams: Promise<{ q?: string; kind?: string }> }) {
  await connection();
  // A plugin's page: there while it's installed.
  if (!isInstalled("teams")) return <PluginNotInstalled id="teams" />;
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const kind: TeamsKind | undefined = sp.kind === "mention" || sp.kind === "pm" ? sp.kind : undefined;
  const settings = getTeamsSettings();
  const counts = teamsMessageCounts();
  const messages = listTeamsMessages({ q, kind, limit: 150 });
  const href = (k?: TeamsKind) => `/teams?${new URLSearchParams({ ...(k ? { kind: k } : {}), ...(q ? { q } : {}) })}`;
  const tabs: { kind?: TeamsKind; label: string; n: number }[] = [
    { label: t("All"), n: counts.all },
    { kind: "mention", label: t("Mentions"), n: counts.mention },
    { kind: "pm", label: t("PMs"), n: counts.pm },
  ];

  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">Teams</h1>
        <p className="text-sm text-zinc-500">
          {t(
            "Where you were @mentioned, and what colleagues wrote you in 1:1 chats — read from Teams in the automation Chrome (from its own cache: nothing is clicked, sent or marked read). Pick them as context on an entry (From: Teams), or add one as context here.",
          )}
        </p>
      </div>

      <section className="card p-4">
        <SyncControls
          syncKey="teams"
          sync={syncTeamsAction}
          syncMinutes={settings.syncMinutes}
          last={
            settings.lastSyncAt
              ? { at: settings.lastSyncAt, ago: agoText(settings.lastSyncAt), ok: !!settings.lastOk, result: settings.lastResult ?? "" }
              : null
          }
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
        <form action="/teams" className="flex min-w-64 flex-1 justify-end gap-2 sm:max-w-md">
          {kind && <input type="hidden" name="kind" value={kind} />}
          <input name="q" defaultValue={q} className="input" placeholder={t("Search sender, chat, words…")} aria-label={t("Search Teams messages")} />
          <button type="submit" className="btn">{t("Search")}</button>
        </form>
      </div>

      {messages.length ? (
        <TeamsMessageList messages={messages} />
      ) : (
        <p className="py-6 text-center text-sm text-zinc-500">
          {counts.all ? t("No message matches.") : t("Nothing synced yet — press Sync now (Teams opens in the automation Chrome if it isn't).")}
        </p>
      )}
      {messages.length === 150 && <p className="text-center text-xs text-zinc-400">{t("The newest 150 — search to find older ones.")}</p>}
    </div>
  );
}
