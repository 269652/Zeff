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
          Welche Gmail-Konten der Mail-Sync liest — die Google-Konten, die im Automations-Chrome dieses Kontos angemeldet sind. „Konto hinzufügen“ holt Googles Anmeldung dort nach vorne; du
          meldest dich selbst an (Zeff gibt nichts ein), dann „Neu laden“.
        </p>
        <p className="text-sm text-zinc-500">
          Die Mails jedes Kontos landen in einem eigenen Ordner — in der{" "}
          <Link href="/apps/gmail" className="text-indigo-600 hover:underline dark:text-indigo-400">
            Gmail-App
          </Link>{" "}
          und unter{" "}
          <Link href="/mail" className="text-indigo-600 hover:underline dark:text-indigo-400">
            Nachrichten
          </Link>{" "}
          je ein Filter.
        </p>
      </div>
      <section className="card space-y-3 p-4">
        <h2 className="font-medium">Konten</h2>
        <GmailAccountsForm signedIn={signedIn} configured={accounts} />
        <p className="text-xs text-zinc-400">Gelesen in die Ordner: {accounts.map((a, i) => gmailFolder(a, i)).join(", ")}</p>
      </section>
    </div>
  );
}
