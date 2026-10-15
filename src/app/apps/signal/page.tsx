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
import { pushTo } from "@/lib/collections";
import { signalAutostart } from "@/plugins/signal/autostart";
import { SIGNAL_PORT, signalRunning, signalUp } from "@/plugins/signal/endpoint";
import { SignalButton } from "@/plugins/signal/SignalButton";
import { pullSignalHistoryAction, setupSignalAutostartAction, startSignalAction } from "@/plugins/signal/server-actions";

export const metadata: Metadata = { title: "Signal" };

/**
 * The Signal app: your chats as Zeff has them (the Signal sync reads them from Signal Desktop over
 * its debug port — no chat opened, nothing marked read), each with its latest messages in order. On
 * top: whether Signal Desktop is reachable, and its autostart with the port.
 */
export default async function SignalAppPage({ searchParams }: { searchParams: Promise<{ q?: string; chat?: string; limit?: string }> }) {
  await connection();
  if (!isInstalled("signal")) return <PluginNotInstalled id="signal" />;
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const limit = Math.min(2000, Math.max(1500, Math.floor(Number(sp.limit)) || 1500));
  const all = listMails({ q, folder: "Signal", limit });
  // By the chat's id (two chats can share a name), the name as its label.
  const chats = new Map<string, MailView[]>();
  for (const m of all) pushTo(chats, m.convId, m);
  const open = sp.chat && chats.has(sp.chat) ? sp.chat : [...chats.keys()][0];
  const openName = open ? chats.get(open)![0].subject : "";
  const thread = [...(open ? (chats.get(open) ?? []) : [])].reverse();
  const step = syncOverview().steps.find((s) => s.key === "signal");
  const href = (chat: string, n?: number) => `/apps/signal?${new URLSearchParams({ chat, ...(q ? { q } : {}), ...(n ? { limit: String(n) } : {}) })}`;
  const [up, running, autostart] = await Promise.all([signalUp(), signalRunning(), signalAutostart()]);

  return (
    <div className="page">
      <div className="page-aside">
        <PluginExperimental id="signal" />
        <h1 className="text-lg font-semibold">Signal</h1>
        <p className="text-sm text-zinc-500">{t("Your chats — read by the Signal sync (sync menu) from Signal Desktop, no chat opened, nothing marked as read.")}</p>
        {step?.lastAt && <p className="text-xs text-zinc-400">{t("Last synced {ago}.", { ago: agoText(step.lastAt) })}</p>}

        <section className="space-y-2 rounded border border-zinc-200 p-2 text-xs dark:border-zinc-800" aria-label={t("Signal Desktop")}>
          <p className="flex items-center gap-2">
            <span className={`size-2 shrink-0 rounded-full ${up ? "bg-emerald-500" : running ? "bg-amber-500" : "bg-zinc-400"}`} aria-hidden />
            {up ? t("Signal Desktop is running with its debug port ({port}).", { port: SIGNAL_PORT }) : running ? t("Signal Desktop is running without its debug port — quit it once (tray icon → Quit), then start it here.") : t("Signal Desktop isn't running.")}
          </p>
          {!up && !running && <SignalButton run={startSignalAction} label={t("Start Signal")} busy={t("Starting Signal …")} title={t("Starts Signal Desktop in the tray, with its debug port")} primary />}
          {autostart.supported && (
            <>
              <p className="text-zinc-500">
                {autostart.withPort
                  ? t("Autostart: Signal starts with its debug port after every login.")
                  : autostart.entry
                    ? t("Autostart: Signal starts after login, but without its debug port.")
                    : t("Autostart: Signal doesn't start after login.")}
              </p>
              {!autostart.withPort && (
                <SignalButton
                  run={setupSignalAutostartAction}
                  label={t("Set up autostart with the port")}
                  busy={t("Setting up …")}
                  title={t("Signal's own autostart entry (Windows) gets the debug port added — Signal writes it anew when you change its tray or autostart setting")}
                />
              )}
            </>
          )}
          <p className="text-zinc-400">{t("The debug port is local only (127.0.0.1) — but any program on this computer could read Signal through it, as with the automation Chrome.")}</p>
        </section>

        <form action="/apps/signal" className="flex gap-2">
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
                {list[0].unread && <UnreadDot className="bg-blue-500" />}
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
            <SignalButton
              run={pullSignalHistoryAction.bind(null, openName)}
              label={t("Load the whole history")}
              busy={t("Loading the history …")}
              title={t("All messages of this chat Signal Desktop has — for the knowledge (no chat opened)")}
            />
          </div>
          <ul className="space-y-1.5">
            {thread.map((m) => {
              const mine = isMine(m);
              return (
                <li key={m.key} className={`flex ${mine ? "justify-end" : ""}`}>
                  <div className={`max-w-[75%] rounded-lg px-3 py-1.5 text-sm ${mine ? "bg-blue-50 dark:bg-blue-950/40" : "bg-zinc-100 dark:bg-zinc-800"}`}>
                    {!mine && m.fromName && m.fromName !== openName &&<div className="text-xs font-medium text-blue-700 dark:text-blue-400">{m.fromName}</div>}
                    <div className="whitespace-pre-line">{m.preview}</div>
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
        <p className="py-6 text-center text-sm text-zinc-500">{q ? t("No message matches.") : t("Nothing synced yet — the Signal sync (sync menu) reads the chats.")}</p>
      )}
    </div>
  );
}
