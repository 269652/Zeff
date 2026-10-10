import type { Metadata } from "next";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { accountDir, currentAccountId, listAccounts } from "@/db/accounts";
import { accountBusy } from "@/lib/accounts";
import { isInstalled } from "@/plugins/state";
import { AccountsManager } from "@/plugins/accounts/AccountsManager";

export const metadata: Metadata = { title: "Konten" };

/**
 * Accounts (Accounts plugin): business and private, say — each with its own data, settings, AI
 * backends and installed plugins. Switch, make one (empty, or with another's settings), rename,
 * remove.
 */
export default async function AccountsPage() {
  await connection();
  if (!isInstalled("accounts")) return <PluginNotInstalled id="accounts" />;
  const current = currentAccountId();
  const accounts = listAccounts().map((a) => ({ ...a, dir: accountDir(a.id), current: a.id === current }));
  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">Konten</h1>
        <p className="max-w-[75ch] text-sm text-zinc-500">
          Jedes Konto ist ein Zeff für sich: eigene Buchungen, Todos und Mails, eigene Einstellungen, KI-Backends, LLM-Anweisungen und installierte Plugins. Ein neues kann die Einstellungen und Konfiguration eines anderen übernehmen — die Daten nicht. Backups laufen je Konto nach dessen Einstellungen, auch wenn du gerade in einem anderen bist.
        </p>
      </div>
      <AccountsManager accounts={accounts} busy={accountBusy()} />
    </div>
  );
}
