"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useT } from "./I18nProvider";
import { TodoRefs } from "./boards/TodoRefs";

type Message = { key: string; name: string; email: string | null; at: string; unread: boolean; subject: string; preview: string; mine: boolean };

/**
 * A conversation of the Messages page: its row (rendered on the server) and, unfolded, its messages — fetched when it is
 * opened (/api/mail/thread), so the page doesn't carry every message of every conversation (that was megabytes and seconds).
 */
export function MailConversation({
  convId,
  total,
  older,
  chat,
  latestSubject,
  link,
  olderHref,
  summary,
}: {
  convId: string;
  /** How many messages the conversation has. */
  total: number;
  /** Show the whole thread, not the last 25. */
  older: boolean;
  chat: boolean;
  latestSubject: string;
  /** Where it lives (Outlook, Gmail): the link at the top of the thread. */
  link: { href: string; label: string } | null;
  /** The page's address with `older=1`, for "Show older". */
  olderHref: string;
  summary: ReactNode;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = () => {
    if (messages || failed) return;
    fetch(`/api/mail/thread?conv=${encodeURIComponent(convId)}${older ? "&older=1" : ""}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ messages: Message[] }>) : Promise.reject(new Error(String(r.status)))))
      .then((d) => setMessages(d.messages))
      .catch(() => setFailed(true));
  };

  return (
    <details
      className="group"
      onToggle={(e) => {
        const now = (e.currentTarget as HTMLDetailsElement).open;
        setOpen(now);
        if (now) load();
      }}
    >
      <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-2.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900/60 [&::-webkit-details-marker]:hidden">{summary}</summary>
      {open && (
        <ul className="space-y-1.5 px-4 pb-3 pl-9">
          {link && (
            <li>
              <a href={link.href} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-sky-700 hover:underline dark:text-sky-400">
                {link.label} ↗<span className="sr-only"> {t("(opens in a new tab)")}</span>
              </a>
            </li>
          )}
          {failed && <li className="text-xs text-red-600 dark:text-red-400">{t("Couldn't load the messages.")}</li>}
          {!messages && !failed && <li className="text-xs text-zinc-400">{t("Loading …")}</li>}
          {messages && total > messages.length && (
            <li className="text-xs text-zinc-500">
              {t("… {n} older", { n: total - messages.length })} ·{" "}
              <Link href={olderHref} className="font-medium text-indigo-700 hover:underline dark:text-indigo-400">
                {t("Show older")}
              </Link>
            </li>
          )}
          {messages?.map((m) => (
            <li key={m.key} className={`flex ${m.mine && chat ? "justify-end" : ""}`}>
              <div className={`max-w-[85%] rounded-lg px-3 py-1.5 text-sm ${m.mine ? "bg-emerald-50 dark:bg-emerald-950/40" : "bg-zinc-100 dark:bg-zinc-800"}`}>
                <div className="flex items-baseline gap-2 text-xs">
                  <span className="font-medium text-zinc-700 dark:text-zinc-200" title={m.email ?? undefined}>
                    {m.mine ? t("Me") : m.name}
                  </span>
                  <span className="text-zinc-400">{m.at}</span>
                  {m.unread && <span className="text-zinc-400">· {t("unread")}</span>}
                </div>
                {!chat && m.subject !== latestSubject && (
                  <div className="text-xs font-medium">
                    <TodoRefs text={m.subject} />
                  </div>
                )}
                <div className="whitespace-pre-line">{m.preview}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
