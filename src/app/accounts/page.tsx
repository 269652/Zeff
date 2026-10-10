import type { Metadata } from "next";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { accountDir, currentAccountId, listAccounts } from "@/db/accounts";
import { accountBusy } from "@/lib/accounts";
import { isInstalled } from "@/plugins/state";
import { AccountsManager } from "@/plugins/accounts/AccountsManager";

export const metadata: Metadata = { title: "Accounts" };

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
        <h1 className="text-lg font-semibold">Accounts</h1>
        <p className="max-w-[75ch] text-sm text-zinc-500">
          Each account is a Zeff of its own: its own entries, todos and mails, its own settings, AI backends, LLM instructions and installed plugins. A new one can take over another&apos;s settings and configuration — not its data. Backups run per account by its own settings, even while you&apos;re in another one.
        </p>
      </div>
      <AccountsManager accounts={accounts} busy={accountBusy()} />
    </div>
  );
}
