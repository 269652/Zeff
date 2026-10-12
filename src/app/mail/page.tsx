import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { isInstalled } from "@/plugins/state";
import type { Metadata } from "next";
import { t } from "@/lib/i18n/server";
import { connection } from "next/server";
import Link from "next/link";
import { syncMailAction } from "@/app/actions";
import { syncWhatsappAction } from "@/plugins/whatsapp/server-actions";
import { syncSignalAction } from "@/plugins/signal/server-actions";
import { MailFoldersForm } from "@/components/MailFoldersForm";
import { FetchAttachmentsButton, MailAttachmentsOffer, MailAttachmentsSettings } from "@/components/MailAttachments";
import { attachmentOfferOpen, attachmentSettings, attachmentTotals } from "@/lib/mail/attachments-store";
import { installedAttachmentSources } from "@/lib/mail/attachments-sync";
import { SyncSplitButton } from "@/components/SyncSplitButton";
import { TodoRefs } from "@/components/boards/TodoRefs";
import { getMailSettings, listMails, mailFolderCounts } from "@/lib/mail/store";
import { isChatFolder, type MailView } from "@/lib/mail/shared";
import { agoText } from "@/lib/teams/time";
import { syncOverview } from "@/lib/sync/registry";
import { pushTo } from "@/lib/collections";
import { formatDate, formatTime } from "@/lib/format";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Messages") };
}

const when = (iso: string) => {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today ? formatTime(d) : formatDate(d);
};

/**
 * Nachrichten: your mails (Outlook, Gmail) and WhatsApp chats in one place, read in the automation
 * Chrome — none opened, none marked read; their syncs in a split button beside the search. The
 * Ticket-Lage reads those that name a ticket.
 */
export default async function MailPage({ searchParams }: { searchParams: Promise<{ q?: string; folder?: string }> }) {
  await connection();
  // A plugin's page: there while Outlook Mail, Gmail, WhatsApp or Signal is installed.
  const outlook = isInstalled("outlook-mail");
  const gmail = isInstalled("gmail");
  const whatsapp = isInstalled("whatsapp");
  const signal = isInstalled("signal");
  if (!outlook && !gmail && !whatsapp && !signal) return <PluginNotInstalled id="outlook-mail" />;
  const source = [outlook && "Outlook", gmail && "Gmail", whatsapp && "WhatsApp", signal && "Signal Desktop"].filter(Boolean).join(", ").replace(/, ([^,]*)$/, ` ${t("and")} $1`);
  const wa = whatsapp ? syncOverview().steps.find((s) => s.key === "whatsapp") : undefined;
  const sg = signal ? syncOverview().steps.find((s) => s.key === "signal") : undefined;
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const counts = mailFolderCounts();
  const folder = sp.folder && sp.folder in counts ? sp.folder : undefined;
  const settings = getMailSettings();
  // Mail attachments → Documents: its settings here, and the one-time notice until it is answered.
  const attachOn = isInstalled("documents") && (outlook || gmail);
  const attachments = attachOn ? attachmentSettings() : null;
  const mails = listMails({ q, folder, limit: 1500 });
  // By conversation (a chat, a mail thread) — newest first, its messages in order.
  const convs = new Map<string, MailView[]>();
  for (const m of mails) pushTo(convs, m.convId, m);
  const conversations = [...convs.values()].slice(0, 200);
  const href = (f?: string) => `/mail?${new URLSearchParams({ ...(f ? { folder: f } : {}), ...(q ? { q } : {}) })}`;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">{t("Messages")}</h1>
        <p className="text-sm text-zinc-500">
          {t(
            "All your messages in one place — read from {source} in the automation Chrome, a filter per source. No mail or chat is opened, nothing marked as read. “Sync now” reads two months, the background sync the last few days. What names a ticket, the briefing reads too; the rest goes through the mail review (Todos).",
            { source },
          )}
        </p>
        {outlook && <MailFoldersForm folders={settings.folders} />}
      </div>

      {attachOn && attachmentOfferOpen() && <MailAttachmentsOffer />}
      {attachments && <MailAttachmentsSettings settings={attachments} sources={installedAttachmentSources()} folders={Object.keys(counts)} totals={attachmentTotals()} />}


      <div className="flex flex-wrap items-center justify-between gap-3">
      <nav className="flex rounded-md border border-zinc-200 p-0.5 text-sm dark:border-zinc-700" aria-label={t("Folders")}>
        {[undefined, ...Object.keys(counts)].map((f) => (
          <Link
            key={f ?? "all"}
            href={href(f)}
            aria-current={folder === f ? "page" : undefined}
            className={`rounded px-3 py-1 ${folder === f ? "bg-zinc-200 font-medium dark:bg-zinc-700" : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`}
          >
            {f ?? t("All")} <span className="text-xs text-zinc-400">{f ? counts[f] : total}</span>
          </Link>
        ))}
      </nav>
      <form action="/mail" className="flex items-center justify-end gap-2">
        {folder && <input type="hidden" name="folder" value={folder} />}
        <input name="q" defaultValue={q} className="input min-w-0 max-w-md flex-1" placeholder={t("Sender, subject, text…")} aria-label={t("Search messages")} />
        <button type="submit" className="btn shrink-0 whitespace-nowrap">{t("Search")}</button>
        {attachments?.enabled && <FetchAttachmentsButton className="btn shrink-0 whitespace-nowrap" short />}
        <SyncSplitButton
          sources={[
            ...(outlook || gmail
              ? [{ key: "mail", label: t("Mails"), minutes: settings.syncMinutes, sync: syncMailAction, last: settings.lastSyncAt ? { at: settings.lastSyncAt, ago: agoText(settings.lastSyncAt), ok: !!settings.lastOk, result: settings.lastResult ?? "" } : null }]
              : []),
            ...(wa ? [{ key: "whatsapp", label: "WhatsApp", minutes: wa.everyMinutes, sync: syncWhatsappAction, last: wa.lastAt ? { at: wa.lastAt, ago: agoText(wa.lastAt), ok: !!wa.lastOk, result: wa.lastMessage ?? "" } : null }] : []),
            ...(sg ? [{ key: "signal", label: "Signal", minutes: sg.everyMinutes, sync: syncSignalAction, last: sg.lastAt ? { at: sg.lastAt, ago: agoText(sg.lastAt), ok: !!sg.lastOk, result: sg.lastMessage ?? "" } : null }] : []),
          ]}
        />
      </form>
      </div>

      {conversations.length ? (
        <ul className="card divide-y divide-zinc-100 dark:divide-zinc-800">
          {conversations.map((list) => {
            const latest = list[0];
            const chat = isChatFolder(latest.folder);
            const unread = list.some((m) => m.unread);
            // Who's in it: the others first (each once), you last.
            const names = [...new Set(list.map((m) => m.fromName ?? m.fromEmail ?? "?"))];
            const people = [...names.filter((n) => n !== "Ich"), ...names.filter((n) => n === "Ich")];
            const thread = [...list].reverse().slice(-25);
            return (
              <li key={latest.convId}>
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-2.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900/60 [&::-webkit-details-marker]:hidden">
                    <span className={`mt-1.5 size-2 shrink-0 rounded-full ${unread ? (chat ? "bg-emerald-500" : "bg-indigo-500") : "bg-transparent"}`} title={unread ? t("Unread") : undefined} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className={`truncate ${unread ? "font-semibold" : "font-medium"}`}>{chat ? latest.subject : <TodoRefs text={latest.subject} />}</span>
                        {latest.folder !== "Posteingang" && <span className="shrink-0 rounded bg-zinc-100 px-1.5 text-[11px] text-zinc-500 dark:bg-zinc-800">{latest.folder}</span>}
                        {list.length > 1 && <span className="shrink-0 text-xs text-zinc-400 tabular-nums">{list.length}</span>}
                        <span className="ml-auto shrink-0 text-xs text-zinc-400">{when(latest.receivedAt)}</span>
                      </div>
                      <div className="truncate text-xs text-zinc-500">{people.slice(0, 4).join(", ")}{people.length > 4 ? ` +${people.length - 4}` : ""}</div>
                      <div className="line-clamp-1 text-xs text-zinc-600 group-open:hidden dark:text-zinc-400">
                        {latest.fromName && (list.length > 1 || chat) ? <span className="font-medium">{latest.fromName}: </span> : null}
                        {latest.preview}
                      </div>
                    </div>
                  </summary>
                  <ul className="space-y-1.5 px-4 pb-3 pl-9">
                    {list.length > thread.length && <li className="text-xs text-zinc-400">{t("… {n} older", { n: list.length - thread.length })}</li>}
                    {thread.map((m) => {
                      const mine = m.fromName === "Ich";
                      return (
                        <li key={m.key} className={`flex ${mine && chat ? "justify-end" : ""}`}>
                          <div className={`max-w-[85%] rounded-lg px-3 py-1.5 text-sm ${mine ? "bg-emerald-50 dark:bg-emerald-950/40" : "bg-zinc-100 dark:bg-zinc-800"}`}>
                            <div className="flex items-baseline gap-2 text-xs">
                              <span className="font-medium text-zinc-700 dark:text-zinc-200" title={m.fromEmail ?? undefined}>{m.fromName ?? m.fromEmail ?? "?"}</span>
                              <span className="text-zinc-400">{when(m.receivedAt)}</span>
                              {m.unread && <span className="text-zinc-400">· {t("unread")}</span>}
                            </div>
                            {!chat && m.subject !== latest.subject && <div className="text-xs font-medium"><TodoRefs text={m.subject} /></div>}
                            <div className="whitespace-pre-line">{m.preview}</div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </details>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="py-6 text-center text-sm text-zinc-500">
          {q ? t("No message matches.") : t("Nothing synced yet — “Sync” opens the inbox ({source}) in the automation Chrome if it isn't open.", { source })}
        </p>
      )}
      {convs.size > conversations.length && (
        <p className="text-center text-xs text-zinc-400">{t("The newest {n} conversations — search to find older ones.", { n: conversations.length })}</p>
      )}
    </div>
  );
}
