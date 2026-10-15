import type { Metadata } from "next";
import Link from "next/link";
import { driverOf } from "@/lib/connectors/store";
import { t } from "@/lib/i18n/server";
import { rich } from "@/lib/i18n/rich";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { GmailAccountsForm } from "@/plugins/gmail/GmailAccountsForm";
import { gmailAccounts, gmailFolder, signedInGmailAccounts } from "@/plugins/gmail/accounts";
import { isInstalled } from "@/plugins/state";

export const metadata: Metadata = { title: "Gmail" };

/** Gmail's settings: which accounts its sync reads — each signed in in the account's automation Chrome, its mails in a folder of its own. */
export default async function GmailSettingsPage() {
  await connection();
  if (!isInstalled("gmail")) return <PluginNotInstalled id="gmail" />;
  const accounts = gmailAccounts();
  const signedIn = await signedInGmailAccounts();
  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">Gmail</h1>
        <p className="text-sm text-zinc-500">
          {t(
            "Which Gmail accounts the mail sync reads — the Google accounts signed in to this account's automation Chrome. “Add account” brings Google's sign-in to the front there; you sign in yourself (Zeff types nothing), then “Reload”.",
          )}
        </p>
        <p className="text-sm text-zinc-500">
          {rich(
            t("Each account's mails land in a folder of their own — in the <app>Gmail app</app> and under <mail>Messages</mail> a filter each."),
            {
              app: (s) => (
                <Link href="/apps/gmail" className="text-indigo-600 hover:underline dark:text-indigo-400">
                  {s}
                </Link>
              ),
              mail: (s) => (
                <Link href="/mail" className="text-indigo-600 hover:underline dark:text-indigo-400">
                  {s}
                </Link>
              ),
            },
          )}
        </p>
      </div>
      {driverOf("gmail") === "api" && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          {rich(t("Gmail is read through Google's API: the accounts below apply to the automation Chrome only. The API reads the account signed in on the <connections>Connections</connections> page."), {
            connections: (s) => (
              <Link href="/connections" className="underline">
                {s}
              </Link>
            ),
          })}
        </p>
      )}
      <section className="card space-y-3 p-4">
        <h2 className="font-medium">{t("Accounts")}</h2>
        <GmailAccountsForm signedIn={signedIn} configured={accounts} />
        <p className="text-xs text-zinc-400">{t("Read into the folders: {folders}", { folders: accounts.map((a, i) => gmailFolder(a, i)).join(", ") })}</p>
      </section>
    </div>
  );
}
