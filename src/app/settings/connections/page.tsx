import type { Metadata } from "next";
import Link from "next/link";
import { inArray } from "drizzle-orm";
import { headers } from "next/headers";
import { connection } from "next/server";
import { getDb, schema } from "@/db";
import { t } from "@/lib/i18n/server";
import { rich } from "@/lib/i18n/rich";
import { PROVIDERS } from "@/lib/connectors/providers";
import { apiConnected, clientOf, driverOf, extraOf, getConnector } from "@/lib/connectors/store";
import { listLogins } from "@/lib/logins";
import { CheckAllLoginsButton } from "@/components/LoginButtons";
import { LoginsList } from "@/components/LoginsList";
import { SyncSettingsList } from "@/components/SyncSettingsList";
import { isInstalled, stepAvailable } from "@/plugins/state";
import type { PluginId } from "@/plugins/catalog";
import { ProviderConnection, type ProviderView } from "./ProviderConnection";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Connections") };
}

type Search = { error?: string; connected?: string; provider?: string; setup?: string };

const LINK = "text-indigo-600 hover:underline dark:text-indigo-400";

/**
 * Connections, one page (Settings → Connections): how Zeff reaches each service — its API with your OAuth sign-in (Google,
 * Microsoft), the sign-ins in the automation Chrome (was /logins), how often each sync runs (was /sync-settings), the Gmail
 * accounts the mail sync reads (was /gmail) and Google Drive (was /google-drive). The old addresses lead to their section.
 */
export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<Search> }) {
  await connection();
  const sp = await searchParams;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const proto = h.get("x-forwarded-proto")?.split(",")[0] ?? "http";
  const view = (id: "google" | "microsoft"): ProviderView => {
    const row = getConnector(id);
    const client = clientOf(id);
    return {
      provider: id,
      label: PROVIDERS[id].label,
      clientId: client.clientId,
      hasSecret: !!client.clientSecret,
      tenant: id === "microsoft" ? (extraOf("microsoft").tenant ?? "") : "",
      gmailWrite: id === "google" && extraOf("google").gmailWrite === "1",
      calendarWrite: id === "google" && extraOf("google").calendarWrite === "1",
      granted: {
        gmailRead: row.scope.includes("gmail.readonly") || row.scope.includes("gmail.modify"),
        gmailModify: row.scope.includes("gmail.modify"),
        gmailFilters: row.scope.includes("gmail.settings.basic"),
        calendar: row.scope.includes("calendar"),
        calendarWrite: row.scope.split(/\s+/).some((x) => x === "https://www.googleapis.com/auth/calendar.events" || x === "https://www.googleapis.com/auth/calendar"),
      },
      connected: apiConnected(row),
      account: row.account,
      redirectUri: `${proto}://${host}/api/connectors/${id}/callback`,
      services: PROVIDERS[id].services.map((s) => ({ service: s.service, label: s.label, driver: driverOf(s.service), installed: isInstalled(s.plugin as PluginId) })),
    };
  };
  // (A sign-in's answer comes back with ?provider=… — the error or the "connected" belongs to that card: google, microsoft, drive.)
  const provider = sp.provider === "microsoft" || sp.provider === "drive" ? sp.provider : "google";
  const errorFor = (p: string) => (provider === p ? (sp.error === "client" ? t("Set your OAuth client first.") : (sp.error ?? null)) : null);
  const { chrome } = await listLogins();
  const gmail = isInstalled("gmail");
  const drive = isInstalled("google-drive");
  const toc: [string, string][] = [
    ["api", t("APIs (OAuth)")],
    ["sign-ins", t("Browser sign-ins")],
    ...(gmail ? ([["gmail-accounts", "Gmail"]] as [string, string][]) : []),
    ...(drive ? ([["google-drive", t("Google Drive")]] as [string, string][]) : []),
    ["syncs", t("Sync settings")],
  ];
  return (
    <div className="page">
      <div className="page-aside">
        <Link href="/settings" className="text-sm text-zinc-500 hover:underline">
          ← {t("Settings")}
        </Link>
        <h1 className="text-lg font-semibold">{t("Connections")}</h1>
        <p className="text-sm text-zinc-500">
          {t("How Zeff reaches each service. The automation Chrome needs nothing set up but has to run, and a service can change its web page at any time. An API with your own OAuth sign-in is the stable way: it syncs in the background whenever you like, and Zeff only asks to read.")}
        </p>
        <p className="mt-2 text-sm">
          {t("GitLab has its own connection on")}{" "}
          <Link href="/gitlab" className={LINK}>
            {t("its page")}
          </Link>
          .
        </p>
        <nav className="flex flex-col gap-0.5 text-sm" aria-label={t("Sections")}>
          {toc.map(([id, label]) => (
            <a key={id} href={`#${id}`} className="rounded px-2 py-1 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">
              {label}
            </a>
          ))}
        </nav>
      </div>

      {sp.setup === "1" && (
        <section className="card border-indigo-200 bg-indigo-50 p-4 text-sm dark:border-indigo-900 dark:bg-indigo-950/40">
          <p className="font-medium">{t("Last step of the setup: sign in to each service.")}</p>
          <p className="text-zinc-600 dark:text-zinc-300">
            {rich(t("For each entry “Sign in”, sign in in the automation Chrome, then “Check”. Then <link>off you go</link>."), {
              link: (s) => (
                <Link href="/" className={LINK}>
                  {s}
                </Link>
              ),
            })}
          </p>
        </section>
      )}

      <div id="api" className="scroll-mt-4 space-y-4">
        <ProviderConnection v={view("google")} error={errorFor("google")} justConnected={sp.connected === "1" && provider === "google"} />
        <ProviderConnection v={view("microsoft")} error={errorFor("microsoft")} justConnected={sp.connected === "1" && provider === "microsoft"} />
      </div>

      <section id="sign-ins" className="scroll-mt-4 space-y-3">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Browser sign-ins")}</h2>
          <p className="max-w-[75ch] text-sm text-zinc-500">
            {t(
              "Where the installed plugins read (and, on your click, write): each site in this account's automation Chrome. “Sign in” brings it to the front there — you sign in yourself, Zeff never types credentials. “Check” asks the plugin whether you're signed in, and opens nothing.",
            )}
          </p>
          <p className="text-xs text-zinc-400">
            {chrome.running
              ? t("Automation Chrome: {endpoint} — running", { endpoint: chrome.endpoint })
              : t("Automation Chrome: {endpoint} — not running (“Sign in” starts it)", { endpoint: chrome.endpoint })}
          </p>
          <CheckAllLoginsButton />
        </div>
        <LoginsList />
      </section>

      {gmail && <GmailCard />}
      {drive && <DriveCard error={errorFor("drive")} justConnected={sp.connected === "1" && provider === "drive"} redirectUri={`${proto}://${host}/api/google-drive/callback`} />}

      <section id="syncs" className="scroll-mt-4 space-y-3">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Sync settings")}</h2>
          <p className="max-w-[75ch] text-sm text-zinc-500">
            {t("How often each sync runs by itself — every installed plugin brings its part. Nothing runs by itself between 19:00 and 08:00; “Sync now” and the sync menu always work.")}
          </p>
        </div>
        <SyncSettingsList />
      </section>
    </div>
  );
}

/** Gmail (was /gmail): which accounts its sync reads — each signed in in the account's automation Chrome, its mails in a folder of its own. */
async function GmailCard() {
  const { GmailAccountsForm } = await import("@/plugins/gmail/GmailAccountsForm");
  const { gmailAccounts, gmailFolder, signedInGmailAccounts } = await import("@/plugins/gmail/accounts");
  const accounts = gmailAccounts();
  const signedIn = await signedInGmailAccounts();
  return (
    <section id="gmail-accounts" className="card scroll-mt-4 space-y-3 p-4">
      <div className="space-y-1">
        <h2 className="font-medium">Gmail</h2>
        <p className="text-sm text-zinc-500">
          {t(
            "Which Gmail accounts the mail sync reads — the Google accounts signed in to this account's automation Chrome. “Add account” brings Google's sign-in to the front there; you sign in yourself (Zeff types nothing), then “Reload”.",
          )}
        </p>
        <p className="text-sm text-zinc-500">
          {rich(t("Each account's mails land in a folder of their own — in the <app>Gmail app</app> and under <mail>Messages</mail> a filter each."), {
            app: (s) => (
              <Link href="/apps/gmail" className={LINK}>
                {s}
              </Link>
            ),
            mail: (s) => (
              <Link href="/mail" className={LINK}>
                {s}
              </Link>
            ),
          })}
        </p>
      </div>
      {driverOf("gmail") === "api" && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          {t("Gmail is read through Google's API (above): the accounts below apply to the automation Chrome only.")}
        </p>
      )}
      <GmailAccountsForm signedIn={signedIn} configured={accounts} />
      <p className="text-xs text-zinc-400">{t("Read into the folders: {folders}", { folders: accounts.map((a, i) => gmailFolder(a, i)).join(", ") })}</p>
    </section>
  );
}

/** Google Drive (was /google-drive): your OAuth client, signing in, what syncs — and how the last syncs went. */
async function DriveCard({ error, justConnected, redirectUri }: { error: string | null; justConnected: boolean; redirectUri: string }) {
  const { GoogleDriveSettings } = await import("@/plugins/google-drive/GoogleDriveSettings");
  const { defaultFolderName, driveRow, hasFullAccess, isConnected } = await import("@/plugins/google-drive/config");
  const { driveCounts } = await import("@/plugins/google-drive/sync");
  const row = driveRow();
  const records = getDb()
    .select()
    .from(schema.syncState)
    .where(inArray(schema.syncState.key, ["drivebackup", "drivedocs"]))
    .all();
  const stepView = (key: "drivebackup" | "drivedocs", name: string) => {
    const r = records.find((x) => x.key === key);
    return { key, name, on: stepAvailable(key), lastAt: r?.lastAt ?? null, lastOk: r?.lastOk ?? null, lastMessage: r?.lastMessage ?? null };
  };
  const counts = driveCounts();
  return (
    <section id="google-drive" className="scroll-mt-4 space-y-3">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Google Drive")}</h2>
        <p className="max-w-[75ch] text-sm text-zinc-500">
          {t("A copy of your documents (and, if you turn it on, your backups) in your own Google Drive — and, if you want, what you add there comes into Zeff.")}{" "}
          <Link href="/plugins" className={LINK}>
            {t("Turn each sync on or off under Plugins")}
          </Link>
        </p>
      </div>
      <GoogleDriveSettings
        error={error}
        justConnected={justConnected}
        redirectUri={redirectUri}
        s={{
          clientId: row.clientId,
          hasSecret: !!row.clientSecret,
          connected: isConnected(row),
          email: row.email,
          connectedAt: row.connectedAt,
          fullAccess: hasFullAccess(row),
          folderName: row.folderName,
          defaultFolder: defaultFolderName(),
          pullFolders: (await import("@/plugins/google-drive/folders")).pullFolders(),
          mirrorBackupRetention: row.mirrorBackupRetention,
          uploadUnencrypted: row.uploadUnencrypted,
          pullDocuments: row.pullDocuments,
          backupsInDrive: counts.backups,
          documentsInDrive: counts.documents,
        }}
        steps={[stepView("drivedocs", t("Documents")), stepView("drivebackup", t("Backups"))]}
      />
    </section>
  );
}
