import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { isInstalled } from "@/plugins/state";
import type { Metadata } from "next";
import { connection } from "next/server";
import Link from "next/link";
import { syncMailAction, syncWhatsappAction } from "@/app/actions";
import { MailFoldersForm } from "@/components/MailFoldersForm";
import { SyncSplitButton } from "@/components/SyncSplitButton";
import { TodoRefs } from "@/components/boards/TodoRefs";
import { getMailSettings, listMails, mailFolderCounts } from "@/lib/mail/store";
import type { MailView } from "@/lib/mail/shared";
import { agoText } from "@/lib/teams/time";
import { syncOverview } from "@/lib/sync/registry";

export const metadata: Metadata = { title: "Nachrichten" };

const when = (iso: string) => {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "short" });
};

/**
 * Nachrichten: your mails (Outlook, Gmail) and WhatsApp chats in one place, read in the automation
 * Chrome — none opened, none marked read; their syncs in a split button beside the search. The
 * Ticket-Lage reads those that name a ticket.
 */
export default async function MailPage({ searchParams }: { searchParams: Promise<{ q?: string; folder?: string }> }) {
  await connection();
  // A plugin's page: there while Outlook Mail, Gmail or WhatsApp is installed.
  const outlook = isInstalled("outlook-mail");
  const gmail = isInstalled("gmail");
  const whatsapp = isInstalled("whatsapp");
  if (!outlook && !gmail && !whatsapp) return <PluginNotInstalled id="outlook-mail" />;
  const source = [outlook && "Outlook", gmail && "Gmail", whatsapp && "WhatsApp"].filter(Boolean).join(", ").replace(/, ([^,]*)$/, " und $1");
  const wa = whatsapp ? syncOverview().steps.find((s) => s.key === "whatsapp") : undefined;
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const counts = mailFolderCounts();
  const folder = sp.folder && sp.folder in counts ? sp.folder : undefined;
  const settings = getMailSettings();
  const mails = listMails({ q, folder, limit: 1500 });
  // By conversation (a WhatsApp chat, a mail thread) — newest first, its messages in order.
  const convs = new Map<string, MailView[]>();
  for (const m of mails) convs.set(m.convId, [...(convs.get(m.convId) ?? []), m]);
  const conversations = [...convs.values()].slice(0, 200);
  const href = (f?: string) => `/mail?${new URLSearchParams({ ...(f ? { folder: f } : {}), ...(q ? { q } : {}) })}`;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">Nachrichten</h1>
        <p className="text-sm text-zinc-500">
          Alle deine Nachrichten an einem Ort — aus {source} im Automation-Chrome gelesen, je Quelle ein Filter. Keine Mail und kein Chat wird geöffnet, nichts als gelesen markiert. „Sync now“
          liest zwei Monate, der Hintergrund-Sync die letzten Tage. Was ein Ticket nennt, liest die Ticket-Lage mit; der Rest geht durch die Durchsicht (Todos).
        </p>
        {outlook && <MailFoldersForm folders={settings.folders} />}
      </div>


      <div className="flex flex-wrap items-center justify-between gap-3">
      <nav className="flex rounded-md border border-zinc-200 p-0.5 text-sm dark:border-zinc-700" aria-label="Ordner">
        {[undefined, ...Object.keys(counts)].map((f) => (
          <Link
            key={f ?? "all"}
            href={href(f)}
            aria-current={folder === f ? "page" : undefined}
            className={`rounded px-3 py-1 ${folder === f ? "bg-zinc-200 font-medium dark:bg-zinc-700" : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`}
          >
            {f ?? "Alle"} <span className="text-xs text-zinc-400">{f ? counts[f] : total}</span>
          </Link>
        ))}
      </nav>
      <form action="/mail" className="flex justify-end gap-2">
        {folder && <input type="hidden" name="folder" value={folder} />}
        <input name="q" defaultValue={q} className="input max-w-md" placeholder="Absender, Betreff, Text …" aria-label="Mails durchsuchen" />
        <button type="submit" className="btn">Suchen</button>
        <SyncSplitButton
          sources={[
            ...(outlook || gmail
              ? [{ key: "mail", label: "Mails", minutes: settings.syncMinutes, sync: syncMailAction, last: settings.lastSyncAt ? { at: settings.lastSyncAt, ago: agoText(settings.lastSyncAt), ok: !!settings.lastOk, result: settings.lastResult ?? "" } : null }]
              : []),
            ...(wa ? [{ key: "whatsapp", label: "WhatsApp", minutes: wa.everyMinutes, sync: syncWhatsappAction, last: wa.lastAt ? { at: wa.lastAt, ago: agoText(wa.lastAt), ok: !!wa.lastOk, result: wa.lastMessage ?? "" } : null }] : []),
          ]}
        />
      </form>
      </div>

      {conversations.length ? (
        <ul className="card divide-y divide-zinc-100 dark:divide-zinc-800">
          {conversations.map((list) => {
            const latest = list[0];
            const chat = latest.folder === "WhatsApp";
            const unread = list.some((m) => m.unread);
            // Who's in it: the others first (each once), you last.
            const names = [...new Set(list.map((m) => m.fromName ?? m.fromEmail ?? "?"))];
            const people = [...names.filter((n) => n !== "Ich"), ...names.filter((n) => n === "Ich")];
            const thread = [...list].reverse().slice(-25);
            return (
              <li key={latest.convId}>
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-2.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900/60 [&::-webkit-details-marker]:hidden">
                    <span className={`mt-1.5 size-2 shrink-0 rounded-full ${unread ? (chat ? "bg-emerald-500" : "bg-indigo-500") : "bg-transparent"}`} title={unread ? "Ungelesen" : undefined} />
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
                    {list.length > thread.length && <li className="text-xs text-zinc-400">… {list.length - thread.length} ältere</li>}
                    {thread.map((m) => {
                      const mine = m.fromName === "Ich";
                      return (
                        <li key={m.key} className={`flex ${mine && chat ? "justify-end" : ""}`}>
                          <div className={`max-w-[85%] rounded-lg px-3 py-1.5 text-sm ${mine ? "bg-emerald-50 dark:bg-emerald-950/40" : "bg-zinc-100 dark:bg-zinc-800"}`}>
                            <div className="flex items-baseline gap-2 text-xs">
                              <span className="font-medium text-zinc-700 dark:text-zinc-200" title={m.fromEmail ?? undefined}>{m.fromName ?? m.fromEmail ?? "?"}</span>
                              <span className="text-zinc-400">{when(m.receivedAt)}</span>
                              {m.unread && <span className="text-zinc-400">· ungelesen</span>}
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
          {q ? "Keine Nachricht passt." : `Noch nichts synchronisiert — „Sync“ öffnet den Posteingang (${source}) im Automation-Chrome, falls er nicht offen ist.`}
        </p>
      )}
      {convs.size > conversations.length && <p className="text-center text-xs text-zinc-400">Die neuesten {conversations.length} Unterhaltungen — such, um ältere zu finden.</p>}
    </div>
  );
}
