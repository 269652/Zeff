import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { MailAttachmentsOffer, MailAttachmentsSettings } from "@/components/MailAttachments";
import { t } from "@/lib/i18n/server";
import { attachmentOfferOpen, attachmentSettings, attachmentTotals } from "@/lib/mail/attachments-store";
import { installedAttachmentSources } from "@/lib/mail/attachments-sync";
import { listMailAccounts, type MailAccountRow } from "@/lib/mail/accounts";
import { mailFolderCounts } from "@/lib/mail/store";
import { formatSmart } from "@/lib/format";
import { isInstalled } from "@/plugins/state";
import { removeMailAccountAction, syncMailAccountAction } from "@/plugins/imap-mail/server-actions";
import { methodLabel } from "@/plugins/imap-mail/ui/labels";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("E-Mail accounts") };
}

const LINK = "text-indigo-600 hover:underline dark:text-indigo-400";

/**
 * Settings → E-Mail: every mail account in one list — Outlook, Gmail, and any mailbox over IMAP or POP3 — each with how it is
 * read, how its last sync went, and its own page (folders, servers, password). "Add account" asks for the provider, then for
 * one of the ways it allows; what that needs is installed along. Below: what is done with the attachments.
 */
export default async function MailSettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await connection();
  const sp = await searchParams;
  const accounts = await listMailAccounts();
  const attachOn = isInstalled("documents");
  const attachments = attachOn ? attachmentSettings() : null;
  const status = (a: MailAccountRow) =>
    a.status === "ok" ? (
      <span className="text-emerald-700 dark:text-emerald-400">✓ {t("works")}</span>
    ) : a.status === "error" ? (
      <span className="text-red-700 dark:text-red-400" title={a.lastResult ?? ""}>
        ⚠ {t("failed")}
      </span>
    ) : a.status === "signin" ? (
      <Link href="/settings/connections#api" className={LINK}>
        {t("sign in")}
      </Link>
    ) : (
      <span className="text-zinc-500">{t("not read yet")}</span>
    );
  return (
    <div className="page">
      <div className="page-aside">
        <Link href="/settings" className="text-sm text-zinc-500 hover:underline">
          ← {t("All settings")}
        </Link>
        <h1 className="text-lg font-semibold">{t("E-Mail accounts")}</h1>
        <p className="text-sm text-zinc-500">{t("Every mailbox Zeff reads, side by side — Gmail, Outlook, T-Online, GMX, WEB.DE or any other. Each is read the way you chose for it; nothing is marked as read.")}</p>
        <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
          <Link href="/mail" className={LINK}>
            {t("Inbox")}
          </Link>
          <Link href="/settings/connections#syncs" className={LINK}>
            {t("How often the mail sync runs")}
          </Link>
        </p>
      </div>

      {sp.ok && <p className="alert-ok">{sp.ok}</p>}
      {sp.error && (
        <p role="alert" className="alert-error">
          {sp.error}
        </p>
      )}

      <section className="card space-y-3 p-4" data-mail-accounts>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Accounts")}</h2>
          <Link href="/settings/mail/add" className="btn btn-primary btn-sm">
            ＋ {t("Add account")}
          </Link>
        </div>
        {accounts.length ? (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {accounts.map((a) => (
              <li key={a.key} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-sm" data-mail-account={a.key}>
                <div className="min-w-48 flex-1">
                  <Link href={a.href} className="font-medium hover:underline">
                    {a.name}
                  </Link>
                  {a.address && <span className="text-zinc-500"> · {a.address}</span>}
                  <div className="text-xs text-zinc-500">
                    {methodLabel(t, a.method)} · {status(a)}
                    {a.lastSyncAt && <> · {t("last read {when}", { when: formatSmart(a.lastSyncAt) })}</>}
                  </div>
                </div>
                <Link href={a.href} className="btn btn-sm">
                  {t("Edit")}
                </Link>
                <form action={syncMailAccountAction}>
                  <input type="hidden" name="key" value={a.key} />
                  <button className="btn btn-sm">{t("Sync now")}</button>
                </form>
                <details className="relative">
                  <summary className="btn btn-sm cursor-pointer list-none">{t("Remove")}</summary>
                  <form action={removeMailAccountAction} className="absolute right-0 z-10 mt-1 w-64 space-y-2 rounded-md border border-zinc-200 bg-white p-3 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                    <input type="hidden" name="key" value={a.key} />
                    <p>{t("No longer read? The mails already kept stay in Zeff.")}</p>
                    <button className="btn btn-sm text-red-700 dark:text-red-400">{t("Remove {name}", { name: a.name })}</button>
                  </form>
                </details>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-zinc-500">{t("No mail account yet. Add one: Zeff asks for the provider, then for how it is read.")}</p>
        )}
      </section>

      {attachOn && attachmentOfferOpen() && <MailAttachmentsOffer />}
      {attachments ? (
        <MailAttachmentsSettings settings={attachments} sources={installedAttachmentSources()} folders={Object.keys(mailFolderCounts())} totals={attachmentTotals()} />
      ) : (
        <p className="text-sm text-zinc-500">{t("Mail attachments need the Documents plugin (Menu → Plugins).")}</p>
      )}
    </div>
  );
}
