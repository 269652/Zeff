import { GmailLabelsForm } from "@/components/GmailLabelsForm";
import { driverOf } from "@/lib/connectors/store";
import { GMAIL_LABELS_PREF } from "@/lib/mail/sync";
import { getPref } from "@/lib/prefs";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { MailAttachmentsOffer, MailAttachmentsSettings } from "@/components/MailAttachments";
import { MailFoldersForm } from "@/components/MailFoldersForm";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { t } from "@/lib/i18n/server";
import { attachmentOfferOpen, attachmentSettings, attachmentTotals } from "@/lib/mail/attachments-store";
import { installedAttachmentSources } from "@/lib/mail/attachments-sync";
import { getMailSettings, mailFolderCounts } from "@/lib/mail/store";
import { isInstalled } from "@/plugins/state";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Mail settings") };
}

/** Settings → Mail: which folders and mailboxes are read, and what happens to the attachments (Documents → knowledge server). */
export default async function MailSettingsPage() {
  await connection();
  const outlook = isInstalled("outlook-mail");
  const gmail = isInstalled("gmail");
  if (!outlook && !gmail) return <PluginNotInstalled id="outlook-mail" />;
  const settings = getMailSettings();
  const attachOn = isInstalled("documents");
  const attachments = attachOn ? attachmentSettings() : null;
  return (
    <div className="page">
      <div className="page-aside">
        <Link href="/settings/all" className="text-sm text-zinc-500 hover:underline">
          ← {t("All settings")}
        </Link>
        <h1 className="text-lg font-semibold">{t("Mail settings")}</h1>
        <p className="text-sm text-zinc-500">{t("What is read from your mailboxes, and what is done with the attachments.")}</p>
      </div>

      <section className="card space-y-2 p-4">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Mailboxes")}</h2>
        {outlook && <MailFoldersForm folders={settings.folders} />}
        {gmail && driverOf("gmail") === "api" && <GmailLabelsForm labels={getPref<string[]>(GMAIL_LABELS_PREF, [])} />}
        <ul className="space-y-1 text-sm">
          {gmail && (
            <li>
              <Link href="/gmail" className="text-indigo-600 hover:underline dark:text-indigo-400">{t("Gmail accounts")}</Link>
              <span className="text-xs text-zinc-500"> — {t("Which Gmail accounts are read")}</span>
            </li>
          )}
          <li>
            <Link href="/sync-settings" className="text-indigo-600 hover:underline dark:text-indigo-400">{t("Sync settings")}</Link>
            <span className="text-xs text-zinc-500"> — {t("How often the mail sync runs")}</span>
          </li>
          <li>
            <Link href="/settings/connections" className="text-indigo-600 hover:underline dark:text-indigo-400">{t("Connections")}</Link>
            <span className="text-xs text-zinc-500"> — {t("Per service: read through the automation Chrome or through its API (OAuth)")}</span>
          </li>
        </ul>
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
