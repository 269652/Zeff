import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import type { MailView } from "@/lib/mail/shared";
import { listMails } from "@/lib/mail/store";
import { syncOverview } from "@/lib/sync/registry";
import { agoText } from "@/lib/teams/time";
import { isInstalled } from "@/plugins/state";
import { HistoryButton } from "@/plugins/whatsapp/HistoryButton";

export const metadata: Metadata = { title: "WhatsApp" };

const when = (iso: string) => {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "short" });
};

/**
 * The WhatsApp app: your chats as Zeff has them (the WhatsApp sync reads them from WhatsApp Web —
 * no chat opened, nothing marked read), each with its latest messages in order. A view for now;
 * a client later.
 */
export default async function WhatsappAppPage({ searchParams }: { searchParams: Promise<{ q?: string; chat?: string }> }) {
  await connection();
  if (!isInstalled("whatsapp")) return <PluginNotInstalled id="whatsapp" />;
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const chats = new Map<string, MailView[]>();
  for (const m of listMails({ q, folder: "WhatsApp", limit: 1500 })) chats.set(m.subject, [...(chats.get(m.subject) ?? []), m]);
  const open = sp.chat && chats.has(sp.chat) ? sp.chat : [...chats.keys()][0];
  const thread = [...(open ? (chats.get(open) ?? []) : [])].reverse();
  const step = syncOverview().steps.find((s) => s.key === "whatsapp");
  const href = (chat: string) => `/apps/whatsapp?${new URLSearchParams({ chat, ...(q ? { q } : {}) })}`;

  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">WhatsApp</h1>
        <p className="text-sm text-zinc-500">Deine Chats — gelesen vom WhatsApp-Sync (Sync-Menü), kein Chat geöffnet, nichts als gelesen markiert.</p>
        {step?.lastAt && <p className="text-xs text-zinc-400">Zuletzt synchronisiert {agoText(step.lastAt)}.</p>}
        <form action="/apps/whatsapp">
          <input name="q" defaultValue={q} className="input" placeholder="Chat, Absender, Text …" aria-label="Chats durchsuchen" />
        </form>
        <nav className="flex flex-col gap-0.5 text-sm" aria-label="Chats">
          {[...chats].map(([chat, list]) => (
            <Link
              key={chat}
              href={href(chat)}
              aria-current={chat === open ? "page" : undefined}
              className={`rounded px-2 py-1.5 ${chat === open ? "bg-zinc-200 dark:bg-zinc-800" : "hover:bg-zinc-100 dark:hover:bg-zinc-900"}`}
            >
              <span className="flex items-baseline gap-2">
                <span className={`truncate ${list[0].unread ? "font-semibold" : "font-medium"}`}>{chat}</span>
                {list[0].unread && <span className="size-2 shrink-0 rounded-full bg-emerald-500" aria-label="ungelesen" />}
                <span className="ml-auto shrink-0 text-xs text-zinc-400">{when(list[0].receivedAt)}</span>
              </span>
              <span className="line-clamp-1 text-xs text-zinc-500">{list[0].preview}</span>
            </Link>
          ))}
        </nav>
      </div>

      {open ? (
        <section className="card space-y-2 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium">{open}</h2>
            <HistoryButton chat={open} />
          </div>
          <ul className="space-y-1.5">
            {thread.map((m) => {
              const mine = m.fromName === "Ich";
              return (
                <li key={m.key} className={`flex ${mine ? "justify-end" : ""}`}>
                  <div className={`max-w-[75%] rounded-lg px-3 py-1.5 text-sm ${mine ? "bg-emerald-50 dark:bg-emerald-950/40" : "bg-zinc-100 dark:bg-zinc-800"}`}>
                    {!mine && m.fromName && m.fromName !== open && <div className="text-xs font-medium text-emerald-700 dark:text-emerald-400">{m.fromName}</div>}
                    <div className="whitespace-pre-line">{m.preview}</div>
                    <div className="text-right text-[10px] text-zinc-400">{when(m.receivedAt)}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        <p className="py-6 text-center text-sm text-zinc-500">{q ? "Keine Nachricht passt." : "Noch nichts synchronisiert — der WhatsApp-Sync (Sync-Menü) liest die Chats."}</p>
      )}
    </div>
  );
}
