import type { Metadata } from "next";
import { PluginExperimental } from "@/components/BetaBadge";
import Link from "next/link";
import { t } from "@/lib/i18n/server";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { isMine, type MailView } from "@/lib/mail/shared";
import { UnreadDot } from "@/components/UnreadDot";
import { listMails } from "@/lib/mail/store";
import { syncOverview } from "@/lib/sync/registry";
import { agoText } from "@/lib/teams/time";
import { formatSmart } from "@/lib/format";
import { isInstalled } from "@/plugins/state";
import { HistoryButton } from "@/plugins/whatsapp/HistoryButton";
import { pushTo } from "@/lib/collections";
import { LoopChip } from "@/plugins/loops/ui/LoopChip";

export const metadata: Metadata = { title: "WhatsApp" };

/**
 * The WhatsApp app: your chats as Zeff has them (the WhatsApp sync reads them from WhatsApp Web —
 * no chat opened, nothing marked read), each with its latest messages in order. A view for now;
 * a client later.
 */
export default async function WhatsappAppPage({ searchParams }: { searchParams: Promise<{ q?: string; chat?: string; limit?: string }> }) {
  await connection();
  if (!isInstalled("whatsapp")) return <PluginNotInstalled id="whatsapp" />;
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const limit = Math.min(2000, Math.max(1500, Math.floor(Number(sp.limit)) || 1500));
  const all = listMails({ q, folder: "WhatsApp", limit });
  // By the chat's id (two chats can share a name), the name as its label.
  const chats = new Map<string, MailView[]>();
  for (const m of all) pushTo(chats, m.convId, m);
  const open = sp.chat && chats.has(sp.chat) ? sp.chat : [...chats.keys()][0];
  const openName = open ? chats.get(open)![0].subject : "";
  const thread = [...(open ? (chats.get(open) ?? []) : [])].reverse();
  const step = syncOverview().steps.find((s) => s.key === "whatsapp");
  const href = (chat: string, n?: number) => `/apps/whatsapp?${new URLSearchParams({ chat, ...(q ? { q } : {}), ...(n ? { limit: String(n) } : {}) })}`;

  // The open loops said in this chat's messages (Open loops plugin): a chip on each.
  const loops = isInstalled("loops") ? (await import("@/plugins/loops/query")).mailLoops().byMessage : null;
  return (
    <div className="page">
      <div className="page-aside">
        <PluginExperimental id="whatsapp" />
        <h1 className="text-lg font-semibold">WhatsApp</h1>
        <p className="text-sm text-zinc-500">{t("Your chats — read by the WhatsApp sync (sync menu), no chat opened, nothing marked as read.")}</p>
        {step?.lastAt && <p className="text-xs text-zinc-400">{t("Last synced {ago}.", { ago: agoText(step.lastAt) })}</p>}
        <form action="/apps/whatsapp" className="flex gap-2">
          <input name="q" defaultValue={q} className="input min-w-0 flex-1" placeholder={t("Chat, sender, text…")} aria-label={t("Search chats")} />
          <button type="submit" className="btn shrink-0">{t("Search")}</button>
        </form>
        <nav className="flex flex-col gap-0.5 text-sm" aria-label={t("Chats")}>
          {[...chats].map(([chat, list]) => (
            <Link
              key={chat}
              href={href(chat)}
              aria-current={chat === open ? "page" : undefined}
              className={`rounded px-2 py-1.5 ${chat === open ? "bg-zinc-200 dark:bg-zinc-800" : "hover:bg-zinc-100 dark:hover:bg-zinc-900"}`}
            >
              <span className="flex items-baseline gap-2">
                <span className={`truncate ${list[0].unread ? "font-semibold" : "font-medium"}`}>{list[0].subject}</span>
                {list[0].unread && <UnreadDot className="bg-emerald-500" />}
                <span className="ml-auto shrink-0 text-xs text-zinc-400">{formatSmart(list[0].receivedAt)}</span>
              </span>
              <span className="line-clamp-1 text-xs text-zinc-500">{list[0].preview}</span>
            </Link>
          ))}
        </nav>
        {all.length >= limit && (
          <p className="text-xs text-zinc-500">
            {t("The newest {n} messages — search to find older ones.", { n: all.length })}
            {limit < 2000 && <> · <Link href={href(open ?? "", 2000)} className="font-medium text-indigo-700 hover:underline dark:text-indigo-400">{t("Show more")}</Link></>}
          </p>
        )}
      </div>

      {open ? (
        <section className="card space-y-2 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium">{openName}</h2>
            <HistoryButton chat={openName} />
          </div>
          <ul className="space-y-1.5">
            {thread.map((m) => {
              const mine = isMine(m);
              return (
                <li key={m.key} className={`flex ${mine ? "justify-end" : ""}`}>
                  <div className={`max-w-[75%] rounded-lg px-3 py-1.5 text-sm ${mine ? "bg-emerald-50 dark:bg-emerald-950/40" : "bg-zinc-100 dark:bg-zinc-800"}`}>
                    {!mine && m.fromName && m.fromName !== openName &&<div className="text-xs font-medium text-emerald-700 dark:text-emerald-400">{m.fromName}</div>}
                    <div className="whitespace-pre-line">{m.preview}</div>
                    {loops?.get(`mail:${m.key}`) && (
                      <div className="mt-0.5 flex justify-end">
                        <LoopChip mine={loops.get(`mail:${m.key}`)!.filter((l) => l.direction === "mine").length} theirs={loops.get(`mail:${m.key}`)!.filter((l) => l.direction === "theirs").length} overdue={loops.get(`mail:${m.key}`)!.filter((l) => l.overdue).length} texts={loops.get(`mail:${m.key}`)!.map((l) => l.text)} />
                      </div>
                    )}
                    <div className="text-right text-xs text-zinc-400">
                      {mine && <span className="sr-only">{t("Me")}, </span>}
                      {formatSmart(m.receivedAt)}
                      {m.unread && <span className="sr-only"> ({t("unread")})</span>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        <p className="py-6 text-center text-sm text-zinc-500">{q ? t("No message matches.") : t("Nothing synced yet — the WhatsApp sync (sync menu) reads the chats.")}</p>
      )}
    </div>
  );
}
