import type { Metadata } from "next";
import Link from "next/link";
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
          Which Gmail accounts the mail sync reads — the Google accounts signed in to this account&apos;s automation Chrome. “Add account” brings Google&apos;s sign-in to the front there; you
          sign in yourself (Zeff types nothing), then “Reload”.
        </p>
        <p className="text-sm text-zinc-500">
          Each account&apos;s mails land in a folder of their own — in the{" "}
          <Link href="/apps/gmail" className="text-indigo-600 hover:underline dark:text-indigo-400">
            Gmail app
          </Link>{" "}
          and under{" "}
          <Link href="/mail" className="text-indigo-600 hover:underline dark:text-indigo-400">
            Messages
          </Link>{" "}
          a filter each.
        </p>
      </div>
      <section className="card space-y-3 p-4">
        <h2 className="font-medium">Accounts</h2>
        <GmailAccountsForm signedIn={signedIn} configured={accounts} />
        <p className="text-xs text-zinc-400">Read into the folders: {accounts.map((a, i) => gmailFolder(a, i)).join(", ")}</p>
      </section>
    </div>
  );
}
