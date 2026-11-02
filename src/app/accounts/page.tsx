import type { Metadata } from "next";
import { prefixOf, slugOf } from "@/lib/account-routes";
import Link from "next/link";
import { t } from "@/lib/i18n/server";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { accountDir, currentAccountId, listAccounts, sharesWorkerSetup } from "@/db/accounts";
import { isInstalled } from "@/plugins/state";
import { AccountsManager } from "@/plugins/accounts/AccountsManager";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Accounts") };
}

/**
 * Accounts (Accounts plugin): business and private, say — each with its own data, settings, AI
 * backends and installed plugins. Switch, make one (empty, or with another's settings), rename,
 * remove.
 */
export default async function AccountsPage() {
  await connection();
  if (!isInstalled("accounts")) return <PluginNotInstalled id="accounts" />;
  const current = currentAccountId();
  const accounts = listAccounts().map((a) => ({ ...a, host: a.host ?? "", slug: slugOf(a), prefix: prefixOf(a), dir: accountDir(a.id), current: a.id === current, workerSetup: sharesWorkerSetup(a.id) }));
  return (
    <div className="page">
      <div className="page-aside">
        <Link href="/settings" className="text-sm text-zinc-500 hover:underline">
          ← {t("Settings")}
        </Link>
        <h1 className="text-lg font-semibold">{t("Accounts")}</h1>
        <p className="max-w-[75ch] text-sm text-zinc-500">
          {t(
            "Each account is a Zeff of its own: its own entries, todos and mails, its own settings, AI backends, LLM instructions and installed plugins. A new one can take over another's settings and configuration — not its data. Backups run per account by its own settings, even while you're in another one.",
          )}
        </p>
      </div>
      <AccountsManager accounts={accounts} />
    </div>
  );
}
