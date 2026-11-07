import { PluginExperimental } from "@/components/BetaBadge";
import { isInstalled } from "@/plugins/state";
import type { Metadata } from "next";
import { t } from "@/lib/i18n/server";
import { connection } from "next/server";
import Link from "next/link";
import { syncMailAction } from "@/app/actions";
import { syncWhatsappAction } from "@/plugins/whatsapp/server-actions";
import { pullSignalHistoryAction, syncSignalAction } from "@/plugins/signal/server-actions";
import { syncTeamsAction } from "@/plugins/teams/server-actions";
import { MailConversation, type ConversationReply } from "@/components/MailConversation";
import { FetchAttachmentsButton, MailAttachmentsOffer } from "@/components/MailAttachments";
import { attachmentOfferOpen, attachmentSettings } from "@/lib/mail/attachments-store";
import { SyncSplitButton } from "@/components/SyncSplitButton";
import { TeamsMessageList } from "@/components/TeamsMessageList";
import { TodoRefs } from "@/components/boards/TodoRefs";
import { getMailSettings, imapFolderNames, listMails, mailFolderCounts } from "@/lib/mail/store";
import { getTeamsSettings, listTeamsMessages, teamsMessageCounts } from "@/lib/teams/store";
import type { TeamsKind } from "@/lib/teams/shared";
import { channelOfFolder as folderChannel, IMAP_ACCOUNT, INBOX_CHANNELS, isChatFolder, isInboxFolder, isMine, sourceLink, type InboxChannel, type MailView } from "@/lib/mail/shared";
import { UnreadDot, UnreadDotSlot } from "@/components/UnreadDot";
import { agoText } from "@/lib/teams/time";
import { syncOverview } from "@/lib/sync/registry";
import { pushTo } from "@/lib/collections";
import { formatSmart } from "@/lib/format";
import { LoopChip } from "@/plugins/loops/ui/LoopChip";
import { opAvailable } from "@/plugins/ops";
import { WRITE_CHANNELS } from "@/plugins/workspace/capabilities";
import { HistoryButton } from "@/plugins/whatsapp/HistoryButton";
import { SignalButton } from "@/plugins/signal/SignalButton";
import { SignalStatus } from "@/plugins/signal/SignalStatus";
import { NewMail } from "@/plugins/imap-mail/ui/NewMail";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Inbox") };
}

type Search = { q?: string; channel?: string; folder?: string; unread?: string; n?: string; older?: string; open?: string; kind?: string };

/**
 * The inbox: all your messages in one place — mails (Outlook, Gmail) and chats (WhatsApp, Signal, Teams), a filter per
 * channel (`?channel=`), within one its folders or accounts (`?folder=`). Read in the automation Chrome (Signal: Signal
 * Desktop) — none opened, none marked read; their syncs in a split button beside the search. A conversation unfolds with its
 * messages and its reply: a mail drafted (sent from here with Gmail's write access), a chat message sent on your click.
 */
export default async function MailPage({ searchParams }: { searchParams: Promise<Search> }) {
  await connection();
  // A plugin's page: there while one of the channels is installed.
  const channels = INBOX_CHANNELS.filter((c) => isInstalled(c.plugin));
  // Nothing to read yet: where a mail account is added (whatever reads it is installed from there).
  if (!channels.length)
    return (
      <div className="mx-auto max-w-xl space-y-3 py-8 text-center">
        <h1 className="text-lg font-semibold">{t("Inbox")}</h1>
        <p className="text-sm text-zinc-500">{t("No mail account yet. Add one — Gmail, Outlook, T-Online, GMX, WEB.DE or any other.")}</p>
        <Link href="/settings/mail/add" className="btn btn-primary btn-sm">
          ＋ {t("Add account")}
        </Link>
      </div>
    );
  const on = (id: InboxChannel) => channels.some((c) => c.id === id);
  const mailOn = on("outlook") || on("gmail") || on("imap");
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const counts = mailFolderCounts();
  // (An IMAP mailbox's folders carry its own name: known by the mails in them.)
  const imapFolders = on("imap") ? imapFolderNames() : undefined;
  const channelOfFolder = (f: string) => folderChannel(f, imapFolders);
  // The channel: asked for, else the folder's (the old links: ?folder=WhatsApp).
  const asked = channels.find((c) => c.id === sp.channel)?.id ?? (sp.folder && sp.folder in counts ? channelOfFolder(sp.folder) : undefined);
  const channel = asked && on(asked) ? asked : undefined;
  const foldersOf = (c: InboxChannel | undefined) => Object.keys(counts).filter((f) => on(channelOfFolder(f)) && (!c || channelOfFolder(f) === c));
  const channelFolders = foldersOf(channel);
  const folder = sp.folder && channelFolders.includes(sp.folder) ? sp.folder : undefined;
  const sum = (fs: string[]) => fs.reduce((a, f) => a + (counts[f] ?? 0), 0);
  const teamsOn = on("teams");
  const teamsCounts = teamsOn ? teamsMessageCounts() : null;
  const unreadOnly = sp.unread === "1";
  const older = sp.older === "1";
  const kind: TeamsKind | undefined = sp.kind === "mention" || sp.kind === "pm" ? sp.kind : undefined;

  const query = (over: { c?: InboxChannel; f?: string; unread?: boolean; n?: number; older?: boolean; kind?: TeamsKind }) => {
    const c = "c" in over ? over.c : channel;
    const f = "f" in over ? over.f : "c" in over ? undefined : folder;
    const u = "unread" in over ? over.unread : unreadOnly;
    const o = "older" in over ? over.older : older;
    const k = "kind" in over ? over.kind : "c" in over ? undefined : kind;
    return `/mail?${new URLSearchParams({ ...(c ? { channel: c } : {}), ...(f ? { folder: f } : {}), ...(q ? { q } : {}), ...(u ? { unread: "1" } : {}), ...(k ? { kind: k } : {}), ...(over.n && over.n > 200 ? { n: String(over.n) } : {}), ...(o ? { older: "1" } : {}) })}`;
  };

  // The syncs of the channels shown (all of them under "All").
  const step = (key: string) => syncOverview().steps.find((s) => s.key === key);
  const wa = on("whatsapp") && (!channel || channel === "whatsapp") ? step("whatsapp") : undefined;
  const sg = on("signal") && (!channel || channel === "signal") ? step("signal") : undefined;
  const settings = getMailSettings();
  const teams = teamsOn && (!channel || channel === "teams") ? getTeamsSettings() : null;
  const syncs = [
    ...(mailOn && (!channel || channel === "outlook" || channel === "gmail" || channel === "imap")
      ? [{ key: "mail", label: t("Mails"), minutes: settings.syncMinutes, sync: syncMailAction, last: settings.lastSyncAt ? { at: settings.lastSyncAt, ago: agoText(settings.lastSyncAt), ok: !!settings.lastOk, result: settings.lastResult ?? "" } : null }]
      : []),
    ...(wa ? [{ key: "whatsapp", label: "WhatsApp", minutes: wa.everyMinutes, sync: syncWhatsappAction, last: wa.lastAt ? { at: wa.lastAt, ago: agoText(wa.lastAt), ok: !!wa.lastOk, result: wa.lastMessage ?? "" } : null }] : []),
    ...(sg ? [{ key: "signal", label: "Signal", minutes: sg.everyMinutes, sync: syncSignalAction, last: sg.lastAt ? { at: sg.lastAt, ago: agoText(sg.lastAt), ok: !!sg.lastOk, result: sg.lastMessage ?? "" } : null }] : []),
    ...(teams ? [{ key: "teams", label: "Teams", minutes: teams.syncMinutes, sync: syncTeamsAction, last: teams.lastSyncAt ? { at: teams.lastSyncAt, ago: agoText(teams.lastSyncAt), ok: !!teams.lastOk, result: teams.lastResult ?? "" } : null }] : []),
  ];

  // Mail attachments → Documents: its settings here, and the one-time notice until it is answered.
  const attachOn = isInstalled("documents") && mailOn && channel !== "teams";
  const attachments = attachOn ? attachmentSettings() : null;
  const source = channels.map((c) => (c.id === "signal" ? "Signal Desktop" : c.name)).join(", ").replace(/, ([^,]*)$/, ` ${t("and")} $1`);

  // How many conversations to show: 200, more with "Show more" (the message query reads up to 2000).
  const shown = Math.min(1000, Math.max(200, Math.floor(Number(sp.n)) || 200));
  const isTeams = channel === "teams";
  const mails = isTeams ? [] : listMails({ q, ...(folder ? { folder } : { folders: foldersOf(channel) }), limit: shown > 200 ? 2000 : 1500 });
  // By conversation (a chat, a mail thread) — newest first, its messages in order.
  const convs = new Map<string, MailView[]>();
  for (const m of mails) pushTo(convs, m.convId, m);
  const allConversations = [...convs.values()].filter((l) => !unreadOnly || l.some((m) => m.unread));
  const conversations = allConversations.slice(0, shown);
  const teamsMessages = isTeams ? listTeamsMessages({ q, kind, limit: 150 }) : [];

  // What can be answered from here: the channels whose action is installed (as a Workspace inbox's capabilities).
  const replyOn = new Set<string>(WRITE_CHANNELS.filter((x) => opAvailable(x.action)).map((x) => x.channel));
  const replyOf = (list: MailView[]): ConversationReply | null => {
    const latest = list[0];
    const c = channelOfFolder(latest.folder);
    if (!replyOn.has(c)) return null;
    if (isChatFolder(latest.folder)) return { kind: "chat", channel: c === "whatsapp" ? "WhatsApp" : "Signal", chat: latest.subject, mailKey: latest.key };
    const other = list.find((m) => !isMine(m) && m.fromEmail) ?? latest;
    const subject = /^(AW|RE|Re|Aw):/.test(latest.subject) ? latest.subject : `AW: ${latest.subject}`;
    return { kind: "mail", account: c === "gmail" ? "Gmail" : c === "imap" ? IMAP_ACCOUNT : "Outlook", to: other.fromEmail ?? "", subject, mailKey: latest.key };
  };
  // A chat's own tools: its whole history loaded (WhatsApp Web, Signal Desktop).
  const toolsOf = (latest: MailView) =>
    latest.folder === "WhatsApp" ? (
      <HistoryButton chat={latest.subject} />
    ) : latest.folder === "Signal" ? (
      <SignalButton
        run={pullSignalHistoryAction.bind(null, latest.subject)}
        label={t("Load the whole history")}
        busy={t("Loading the history …")}
        title={t("All messages of this chat Signal Desktop has — for the knowledge (no chat opened)")}
      />
    ) : null;

  // The open loops said in these threads (Open loops plugin): a chip on each.
  const loops = isInstalled("loops") && !isTeams ? (await import("@/plugins/loops/query")).mailLoops().byThread : null;
  const tab = (active: boolean) => `shrink-0 rounded px-3 py-1 whitespace-nowrap ${active ? "bg-zinc-200 font-medium dark:bg-zinc-700" : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`;
  const allCount = sum(foldersOf(undefined)) + (teamsCounts?.all ?? 0);
  const channelCount = (c: InboxChannel) => (c === "teams" ? (teamsCounts?.all ?? 0) : sum(foldersOf(c)));
  const folderLabel = (f: string) => f.replace(/^Gmail · /, "") || f;
  const teamsTabs: { kind?: TeamsKind; label: string; n: number }[] = teamsCounts
    ? [
        { label: t("All"), n: teamsCounts.all },
        { kind: "mention", label: t("Mentions"), n: teamsCounts.mention },
        { kind: "pm", label: t("PMs"), n: teamsCounts.pm },
      ]
    : [];

  return (
    <div className="page">
      <div className="page-aside">
        {(channel === "whatsapp" || channel === "signal") && <PluginExperimental id={channel} />}
        <h1 className="text-lg font-semibold">{t("Inbox")}</h1>
        <p className="text-sm text-zinc-500">
          {t(
            "All your messages in one place — read from {source}, a filter per channel. No mail or chat is opened, nothing marked as read. “Sync now” reads two months, the background sync the last few days. A conversation unfolds with its reply. What names a ticket, the briefing reads too; the rest goes through the mail review (Todos).",
            { source },
          )}
        </p>
        <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
          <Link href="/settings/mail" className="text-indigo-600 hover:underline dark:text-indigo-400">
            {t("E-Mail accounts")}
          </Link>
          <Link href="/settings/mail/add" className="text-indigo-600 hover:underline dark:text-indigo-400">
            ＋ {t("Add account")}
          </Link>
          {teamsOn && (
            <Link href="/settings/connections" className="text-indigo-600 hover:underline dark:text-indigo-400">
              {t("Teams connection")}
            </Link>
          )}
        </p>
        {channel === "signal" && <SignalStatus />}
        {/* A new mail from the IMAP mailbox (the other mailboxes are written to in their own apps). */}
        {on("imap") && opAvailable("imap-send") && (!channel || channel === "imap") && (
          <div className="mt-2">
            <NewMail accounts={(await import("@/plugins/imap-mail/config")).mailAccounts().map((a) => ({ id: a.id, name: (a.name || a.address) + (a.address && a.name ? ` <${a.address}>` : "") }))} />
          </div>
        )}
        {isTeams && (
          <p className="text-sm text-zinc-500">
            {t("Where you were @mentioned, and what colleagues wrote you in 1:1 chats — read from Teams in the automation Chrome (from its own cache: nothing is clicked, sent or marked read). Pick them as context on an entry (From: Teams), or add one as context here.")}
          </p>
        )}
      </div>

      {attachOn && attachmentOfferOpen() && <MailAttachmentsOffer />}

      {/* The channels — and within one its folders or accounts. (On a phone they scroll sideways, each on one line.) */}
      <nav className="flex max-w-full overflow-x-auto rounded-md border border-zinc-200 p-0.5 text-sm [scrollbar-width:none] dark:border-zinc-700" aria-label={t("Channels")}>
        <Link href={query({ c: undefined })} aria-current={!channel ? "page" : undefined} className={tab(!channel)}>
          {t("All")} <span className="text-xs text-zinc-600 dark:text-zinc-300">{allCount}</span>
        </Link>
        {channels.map((c) => (
          <Link key={c.id} href={query({ c: c.id })} aria-current={channel === c.id ? "page" : undefined} className={tab(channel === c.id)}>
            {c.name} <span className="text-xs text-zinc-600 dark:text-zinc-300">{channelCount(c.id)}</span>
          </Link>
        ))}
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-3">
        {channel && !isTeams && channelFolders.length > 1 && (
          <nav className="flex max-w-full overflow-x-auto rounded-md border border-zinc-200 p-0.5 text-sm [scrollbar-width:none] dark:border-zinc-700" aria-label={channel === "gmail" ? t("Accounts") : t("Folders")}>
            {[undefined, ...channelFolders].map((f) => (
              <Link key={f ?? "all"} href={query({ f })} aria-current={folder === f ? "page" : undefined} className={tab(folder === f)}>
                {f ? folderLabel(f) : t("All")} <span className="text-xs text-zinc-600 dark:text-zinc-300">{f ? counts[f] : sum(channelFolders)}</span>
              </Link>
            ))}
          </nav>
        )}
        {isTeams && (
          <nav className="flex rounded-md border border-zinc-200 p-0.5 text-sm dark:border-zinc-700" aria-label={t("Kind")}>
            {teamsTabs.map((x) => (
              <Link key={x.label} href={query({ kind: x.kind })} aria-current={kind === x.kind ? "page" : undefined} className={tab(kind === x.kind)}>
                {x.label} <span className="text-xs text-zinc-600 dark:text-zinc-300">{x.n}</span>
              </Link>
            ))}
          </nav>
        )}
        {!isTeams && (
          <Link
            href={query({ unread: !unreadOnly })}
            aria-current={unreadOnly ? "true" : undefined}
            className={`rounded-md border px-3 py-1 text-sm ${unreadOnly ? "border-indigo-300 bg-indigo-50 font-medium text-indigo-800 dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-200" : "border-zinc-200 text-zinc-500 hover:text-zinc-800 dark:border-zinc-700 dark:hover:text-zinc-200"}`}
          >
            {unreadOnly ? t("Unread only — show all") : t("Unread only")}
          </Link>
        )}
        <form action="/mail" className="flex flex-1 flex-wrap items-center justify-end gap-2">
          {channel && <input type="hidden" name="channel" value={channel} />}
          {folder && <input type="hidden" name="folder" value={folder} />}
          {kind && <input type="hidden" name="kind" value={kind} />}
          {unreadOnly && <input type="hidden" name="unread" value="1" />}
          <input name="q" defaultValue={q} className="input min-w-0 max-w-md flex-1 max-sm:max-w-none max-sm:basis-full" placeholder={t("Sender, subject, text…")} aria-label={t("Search messages")} />
          <button type="submit" className="btn shrink-0 whitespace-nowrap">{t("Search")}</button>
          {attachments?.enabled && <FetchAttachmentsButton className="btn shrink-0 whitespace-nowrap" short />}
          <SyncSplitButton sources={syncs} />
        </form>
      </div>

      {isTeams ? (
        teamsMessages.length ? (
          <>
            <TeamsMessageList messages={teamsMessages} />
            {teamsMessages.length === 150 && <p className="text-center text-xs text-zinc-400">{t("The newest 150 — search to find older ones.")}</p>}
          </>
        ) : (
          <p className="py-6 text-center text-sm text-zinc-500">
            {teamsCounts?.all ? t("No message matches.") : t("Nothing synced yet — press Sync now (Teams opens in the automation Chrome if it isn't).")}
          </p>
        )
      ) : conversations.length ? (
        <ul className="card divide-y divide-zinc-100 dark:divide-zinc-800">
          {conversations.map((list) => {
            const latest = list[0];
            const chat = isChatFolder(latest.folder);
            const unread = list.some((m) => m.unread);
            // Who's in it: the others first (each once), you last.
            const names = [...new Set(list.map((m) => m.fromName ?? m.fromEmail ?? "?"))];
            const people = [...names.filter((n) => !isMine(n)), ...names.filter((n) => isMine(n))].map((n) => (isMine(n) ? t("Me") : n));
            const link = sourceLink(latest);
            // Under "All" (or a channel's All), where each comes from.
            const where = !folder && (!channel || channelFolders.length > 1) && !isInboxFolder(latest.folder) ? (channel === "gmail" ? folderLabel(latest.folder) : latest.folder) : null;
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
                  reply={replyOf(list)}
                  tools={toolsOf(latest)}
                  defaultOpen={sp.open === latest.convId}
                  summary={
                    <>
                      {unread ? <span className="mt-1.5 flex"><UnreadDot className={chat ? (latest.folder === "Signal" ? "bg-blue-500" : "bg-emerald-500") : "bg-indigo-500"} /></span> : <UnreadDotSlot />}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className={`truncate ${unread ? "font-semibold" : "font-medium"}`}>{chat ? latest.subject : <TodoRefs text={latest.subject} />}</span>
                          {where && <span className="shrink-0 rounded bg-zinc-100 px-1.5 text-xs text-zinc-500 dark:bg-zinc-800">{where}</span>}
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
      {!isTeams && allConversations.length > conversations.length && (
        <p className="text-center text-xs text-zinc-500">
          {t("The newest {n} conversations — search to find older ones.", { n: conversations.length })}
          {shown < 1000 && <> · <Link href={query({ n: shown + 200 })} className="font-medium text-indigo-700 hover:underline dark:text-indigo-400">{t("Show more")}</Link></>}
        </p>
      )}
    </div>
  );
}
