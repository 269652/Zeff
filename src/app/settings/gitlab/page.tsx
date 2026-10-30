import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { SyncControls } from "@/components/SyncControls";
import { apiConnected, getConnector } from "@/lib/connectors/store";
import { getGitlabSettings } from "@/lib/gitlab/store";
import { t } from "@/lib/i18n/server";
import { agoText } from "@/lib/teams/time";
import { GitlabConnection } from "@/plugins/gitlab/GitlabConnection";
import { saveGitlabSyncAction, syncGitlabAction } from "@/plugins/gitlab/server-actions";
import { isInstalled } from "@/plugins/state";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("GitLab settings") };
}

/** Settings → GitLab: the address, how it is reached (automation Chrome, or API with a token / OAuth) and the sync. */
export default async function GitlabSettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; connected?: string }> }) {
  await connection();
  if (!isInstalled("gitlab")) return <PluginNotInstalled id="gitlab" />;
  const h = await headers();
  const hostHeader = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const proto = h.get("x-forwarded-proto")?.split(",")[0] ?? "http";
  const sp = await searchParams;
  const connector = getConnector("gitlab");
  const settings = getGitlabSettings();
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
        <Link href="/settings" className="text-sm text-zinc-500 hover:underline">
          ← {t("All settings")}
        </Link>
        <h1 className="text-lg font-semibold">{t("GitLab settings")}</h1>
        <p className="text-sm text-zinc-500">
          {t("Your GitLab's address and how it is reached.")} <Link href="/gitlab" className="text-indigo-600 hover:underline dark:text-indigo-400">{t("Open GitLab")}</Link>
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
    </div>
  );
}
