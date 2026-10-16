"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { confirmAction } from "@/components/confirm";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";
import type { AppViewProps } from "@/plugins/workspace/ui/app-view";
import type { Row } from "@/plugins/workspace/model";
import { sendChatMessageAction } from "../server-actions";
import { NewInbox } from "./NewInbox";

/**
 * The chat: a message database (Teams, WhatsApp, Signal — its rows a pipeline keeps) as conversations and their messages,
 * yours on the right, and a reply — sent through the channel's own way (as the auto-actions send).
 */

const ICON: Record<string, string> = { Teams: "🟣", WhatsApp: "🟢", Signal: "🔵" };
const time = (v: unknown) => {
  const d = v ? new Date(String(v)) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleString([], { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
};

export default function ChatView({ data, rows, openRow, reload }: AppViewProps) {
  const t = useT();
  const channelOf = (r: Row) => data.schema.properties.find((p) => p.id === "msgchannel")?.options?.find((o) => o.id === r.cells.msgchannel)?.name ?? "";
  const chats = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of rows) {
      const k = String(r.cells.msgconv ?? r.cells.msgchat ?? r.id);
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return [...m.entries()]
      .map(([k, list]) => ({ key: k, list: list.sort((a, b) => String(a.cells.msgsent ?? "").localeCompare(String(b.cells.msgsent ?? ""))) }))
      .sort((a, b) => String(b.list.at(-1)?.cells.msgsent ?? "").localeCompare(String(a.list.at(-1)?.cells.msgsent ?? "")));
  }, [rows]);
  const [picked, setPicked] = useState<string | null>(null);
  const chat = chats.find((c) => c.key === picked) ?? chats[0] ?? null;
  return (
    <div className="grid h-[70vh] min-h-96 grid-cols-[18rem_minmax(0,1fr)] overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800" data-app-view="chat">
      <div className="flex min-h-0 flex-col border-r border-zinc-200 dark:border-zinc-800">
      <div className="flex justify-end border-b border-zinc-100 px-3 py-1 dark:border-zinc-800">
        <NewInbox dbId={data.id} dataType="message" />
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto" aria-label={t("Chats")}>
        {chats.map((c) => {
          const last = c.list.at(-1)!;
          return (
            <li key={c.key}>
              <button type="button" onClick={() => setPicked(c.key)} className={`block w-full border-b border-zinc-100 px-3 py-2 text-left dark:border-zinc-800 ${chat?.key === c.key ? "bg-indigo-50 dark:bg-indigo-950/40" : "hover:bg-zinc-50 dark:hover:bg-zinc-900"}`}>
                <span className="flex items-baseline gap-2">
                  <span aria-hidden>{ICON[channelOf(last)] ?? "💬"}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{String(last.cells.msgchat ?? "")}</span>
                  <span className="shrink-0 text-xs text-zinc-400">{time(last.cells.msgsent)}</span>
                </span>
                <span className="block truncate text-xs text-zinc-500">
                  {last.cells.msgmine ? `${t("Me")}: ` : ""}
                  {last.title}
                </span>
              </button>
            </li>
          );
        })}
        {!chats.length && <li className="p-4 text-sm text-zinc-500">{t("No messages here.")}</li>}
      </ul>
      </div>
      {chat ? <Conversation key={chat.key} list={chat.list} channel={channelOf(chat.list.at(-1)!)} canReply={!!data.extras?.capabilities?.reply.includes(channelOf(chat.list.at(-1)!))} openRow={openRow} reload={reload} /> : <p className="p-4 text-sm text-zinc-500">{t("Pick a chat.")}</p>}
    </div>
  );
}

function Conversation({ list, channel, canReply, openRow, reload }: { list: Row[]; channel: string; canReply: boolean; openRow: (id: number) => void; reload: () => void }) {
  const t = useT();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const name = String(list.at(-1)?.cells.msgchat ?? "");
  // Opened at its newest message (the bottom), as a chat does.
  const scroller = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [list.length]);
  const link = list.map((r) => r.cells.srcurl).find((u) => typeof u === "string") as string | undefined;
  const send = async () => {
    const body = text.trim();
    if (!body || !confirmAction(t("Send to “{chat}” via {channel}?", { chat: name, channel }))) return;
    setBusy(true);
    const r = await sendChatMessageAction(channel, name, body);
    setBusy(false);
    if (!r.ok) return void toast(r.error, { tone: "error" });
    setText("");
    toast(t("Sent."), { tone: "ok" });
    reload();
  };
  return (
    <section className="flex min-w-0 flex-col" aria-label={name}>
      <header className="flex items-center gap-2 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
        <span aria-hidden>{ICON[channel] ?? "💬"}</span>
        <h2 className="min-w-0 flex-1 truncate font-semibold">{name}</h2>
        {link && (
          <a href={link} target="_blank" rel="noreferrer" className="btn btn-sm">
            ↗ {t("Open in {app}", { app: channel })}
          </a>
        )}
      </header>
      <ol ref={scroller} className="flex-1 space-y-2 overflow-y-auto p-4">
        {list.map((r) => (
          <li key={r.id} className={`flex ${r.cells.msgmine ? "justify-end" : ""}`}>
            <button type="button" onClick={() => openRow(r.id)} className={`max-w-[75%] rounded-2xl px-3 py-2 text-left text-sm ${r.cells.msgmine ? "bg-indigo-600 text-white" : "bg-zinc-100 dark:bg-zinc-800"}`}>
              {!r.cells.msgmine && <span className="block text-xs font-medium opacity-70">{String(r.cells.msgsender ?? "")}</span>}
              <span className="block whitespace-pre-wrap">{r.title}</span>
              <span className="block text-right text-[10px] opacity-60">{time(r.cells.msgsent)}</span>
            </button>
          </li>
        ))}
      </ol>
      {/* The source says whether it can be written to: a reply field, or its read-only version. */}
      {!canReply ? (
        <p className="border-t border-zinc-200 px-4 py-2 text-xs text-zinc-500 dark:border-zinc-800" data-read-only>
          🔒 {t("Read-only — replying through {channel} isn't set up here.", { channel })}
        </p>
      ) : (
      <form
        className="flex gap-2 border-t border-zinc-200 p-2 dark:border-zinc-800"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          className="input min-h-10 flex-1 resize-none text-sm"
          rows={1}
          value={text}
          readOnly={busy}
          placeholder={t("Reply …")}
          aria-label={t("Reply")}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !text.trim()}>
          {busy ? "…" : t("Send")}
        </button>
      </form>
      )}
    </section>
  );
}
