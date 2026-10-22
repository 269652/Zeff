import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { isInstalled } from "@/plugins/state";
import type { Metadata } from "next";
import { t } from "@/lib/i18n/server";
import { connection } from "next/server";
import Link from "next/link";
import { syncMailAction } from "@/app/actions";
import { syncWhatsappAction } from "@/plugins/whatsapp/server-actions";
import { syncSignalAction } from "@/plugins/signal/server-actions";
import { MailConversation } from "@/components/MailConversation";
import { FetchAttachmentsButton, MailAttachmentsOffer } from "@/components/MailAttachments";
import { attachmentOfferOpen, attachmentSettings } from "@/lib/mail/attachments-store";
import { SyncSplitButton } from "@/components/SyncSplitButton";
import { TodoRefs } from "@/components/boards/TodoRefs";
import { getMailSettings, listMails, mailFolderCounts } from "@/lib/mail/store";
import { isChatFolder, isInboxFolder, isMine, sourceLink, type MailView } from "@/lib/mail/shared";
import { UnreadDot, UnreadDotSlot } from "@/components/UnreadDot";
import { agoText } from "@/lib/teams/time";
import { syncOverview } from "@/lib/sync/registry";
import { pushTo } from "@/lib/collections";
import { formatSmart } from "@/lib/format";
import { LoopChip } from "@/plugins/loops/ui/LoopChip";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Messages") };
}

/**
 * Nachrichten: your mails (Outlook, Gmail) and WhatsApp chats in one place, read in the automation
 * Chrome — none opened, none marked read; their syncs in a split button beside the search. The
 * Ticket-Lage reads those that name a ticket.
 */
export default async function MailPage({ searchParams }: { searchParams: Promise<{ q?: string; folder?: string; unread?: string; n?: string; older?: string }> }) {
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
  const unreadOnly = sp.unread === "1";
  const older = sp.older === "1";
  // How many conversations to show: 200, more with "Show more" (the message query reads up to 2000).
  const shown = Math.min(1000, Math.max(200, Math.floor(Number(sp.n)) || 200));
  const mails = listMails({ q, folder, limit: shown > 200 ? 2000 : 1500 });
  // By conversation (a chat, a mail thread) — newest first, its messages in order.
  const convs = new Map<string, MailView[]>();
  for (const m of mails) pushTo(convs, m.convId, m);
  const allConversations = [...convs.values()].filter((l) => !unreadOnly || l.some((m) => m.unread));
  const conversations = allConversations.slice(0, shown);
  const query = (over: { f?: string; unread?: boolean; n?: number; older?: boolean }) => {
    const f = "f" in over ? over.f : folder;
    const u = "unread" in over ? over.unread : unreadOnly;
    const o = "older" in over ? over.older : older;
    return `/mail?${new URLSearchParams({ ...(f ? { folder: f } : {}), ...(q ? { q } : {}), ...(u ? { unread: "1" } : {}), ...(over.n && over.n > 200 ? { n: String(over.n) } : {}), ...(o ? { older: "1" } : {}) })}`;
  };
  const href = (f?: string) => query({ f });
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  // The open loops said in these threads (Open loops plugin): a chip on each.
  const loops = isInstalled("loops") ? (await import("@/plugins/loops/query")).mailLoops().byThread : null;
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
        {(outlook || gmail) && (
          <p className="mt-2 text-xs">
            <Link href="/settings/mail" className="text-indigo-600 hover:underline dark:text-indigo-400">{t("Mail settings")}</Link>
            <span className="text-zinc-400"> — {t("folders, attachments → Documents")}</span>
          </p>
        )}
      </div>

      {attachOn && attachmentOfferOpen() && <MailAttachmentsOffer />}


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
      <Link
        href={query({ unread: !unreadOnly })}
        aria-current={unreadOnly ? "true" : undefined}
        className={`rounded-md border px-3 py-1 text-sm ${unreadOnly ? "border-indigo-300 bg-indigo-50 font-medium text-indigo-800 dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-200" : "border-zinc-200 text-zinc-500 hover:text-zinc-800 dark:border-zinc-700 dark:hover:text-zinc-200"}`}
      >
        {unreadOnly ? t("Unread only — show all") : t("Unread only")}
      </Link>
      <form action="/mail" className="flex items-center justify-end gap-2">
        {folder && <input type="hidden" name="folder" value={folder} />}
        {unreadOnly && <input type="hidden" name="unread" value="1" />}
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
            const people = [...names.filter((n) => !isMine(n)), ...names.filter((n) => isMine(n))].map((n) => (isMine(n) ? t("Me") : n));
            const link = sourceLink(latest);
            return (
              <li key={latest.convId}>
                <MailConversation
                  convId={latest.convId}
                  total={list.length}
                  older={older}
                  chat={chat}
                  latestSubject={latest.subject}
                  link={link ? { href: link.href, label: link.label === "Open in Gmail" ? t("Open in Gmail") : t("Open in Outlook") } : null}
                  olderHref={query({ older: true })}
                  summary={
                    <>
                      {unread ? <span className="mt-1.5 flex"><UnreadDot className={chat ? "bg-emerald-500" : "bg-indigo-500"} /></span> : <UnreadDotSlot />}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className={`truncate ${unread ? "font-semibold" : "font-medium"}`}>{chat ? latest.subject : <TodoRefs text={latest.subject} />}</span>
                          {!isInboxFolder(latest.folder) && <span className="shrink-0 rounded bg-zinc-100 px-1.5 text-xs text-zinc-500 dark:bg-zinc-800">{latest.folder}</span>}
                          {list.length > 1 && <span className="shrink-0 text-xs text-zinc-400 tabular-nums">{list.length}</span>}
                          {loops?.get(latest.convId) && <LoopChip {...loops.get(latest.convId)!} />}
                          <span className="ml-auto shrink-0 text-xs text-zinc-400">{formatSmart(latest.receivedAt)}</span>
                        </div>
                        <div className="truncate text-xs text-zinc-500">{people.slice(0, 4).join(", ")}{people.length > 4 ? ` +${people.length - 4}` : ""}</div>
                        <div className="line-clamp-1 text-xs text-zinc-600 group-open:hidden dark:text-zinc-400">
                          {latest.fromName && (list.length > 1 || chat) ? <span className="font-medium">{isMine(latest) ? t("Me") : latest.fromName}: </span> : null}
                          {latest.preview}
                        </div>
                      </div>
                    </>
                  }
                />
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="py-6 text-center text-sm text-zinc-500">
          {q ? t("No message matches.") : t("Nothing synced yet — “Sync” opens the inbox ({source}) in the automation Chrome if it isn't open.", { source })}
        </p>
      )}
      {allConversations.length > conversations.length && (
        <p className="text-center text-xs text-zinc-500">
          {t("The newest {n} conversations — search to find older ones.", { n: conversations.length })}
          {shown < 1000 && <> · <Link href={query({ n: shown + 200 })} className="font-medium text-indigo-700 hover:underline dark:text-indigo-400">{t("Show more")}</Link></>}
        </p>
      )}
    </div>
  );
}
