import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { EmptyState } from "@/components/EmptyState";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { formatAgo } from "@/lib/format";
import { t } from "@/lib/i18n/server";
import { creditPayments, markedAccounts, recipients } from "@/plugins/finances/accounts";
import { monthlySpending } from "@/plugins/finances/metrics";
import { markAccountFormAction } from "@/plugins/finances/server-actions";
import { isInstalled } from "@/plugins/state";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Finances settings") };
}

const euro = (v: number) => `${v.toLocaleString("de-DE", { maximumFractionDigits: 0 })} €`;

/** Settings → Finances: which recipients of your transfers are accounts of your own — money sent there is no spending. */
export default async function FinancesSettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await connection();
  if (!isInstalled("finances")) return <PluginNotInstalled id="finances" />;
  const sp = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const list = recipients(today);
  const spending = monthlySpending(today);
  const credit = creditPayments(today, markedAccounts());

  return (
    <div className="page">
      <div className="page-aside">
        <Link href="/settings" className="text-sm text-zinc-500 hover:underline">
          ← {t("Settings")}
        </Link>
        <h1 className="text-lg font-semibold">{t("Finances settings")}</h1>
        <p className="text-sm text-zinc-500">{t("What the Finances plugin counts as spending.")}</p>
        <Link href="/workspace/metrics" className="btn btn-sm w-full text-center">
          {t("To the Kennzahlen")}
        </Link>
        {sp.error && <p role="alert" className="alert-error text-sm">{sp.error}</p>}
        {sp.ok && <p role="status" className="alert-ok text-sm">{sp.ok}</p>}
      </div>

      <div className="space-y-4">
        <section id="accounts" className="card space-y-3 p-4">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Your own accounts")}</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            {t("Money you send to an account of your own is no spending: a second current account or a depot (it only moved), a credit card or loan account you pay into (it pays a debt off). Mark those recipients here — Ausgaben and Sparquote leave them out, and they aren't suggested as contracts. Pockets and savings with money going both ways are recognised by themselves.")}
          </p>
          <p className="text-sm">
            {t("Spending a month now")}: <strong>{spending == null ? "–" : euro(spending)}</strong>
            {credit != null && (
              <>
                {" · "}
                {t("to credit accounts")}: <strong>{euro(credit)}</strong>
              </>
            )}
          </p>
          {list.length === 0 ? (
            <EmptyState>{t("No transfers in your bank statements of the last six months.")}</EmptyState>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {list.map((r) => (
                <li key={r.key} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2 text-sm">
                  <div className="min-w-0 flex-1 basis-60">
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-zinc-500">
                      {t("{n} transfers, {amount} in six months · last {ago}", { n: r.count, amount: euro(r.out), ago: formatAgo(r.last) })}
                      {r.moved && !r.kind && ` · ${t("money goes both ways: left out by itself")}`}
                    </div>
                  </div>
                  <form action={markAccountFormAction} className="flex items-center gap-2">
                    <input type="hidden" name="key" value={r.key} />
                    <select name="kind" defaultValue={r.kind ?? ""} className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900" aria-label={t("What this account is")}>
                      <option value="">{t("Not mine (spending)")}</option>
                      <option value="own">{t("Own account")}</option>
                      <option value="credit">{t("Credit account")}</option>
                    </select>
                    <button className="btn btn-sm">{t("Set")}</button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
