"use client";

import { useEffect, useMemo, useState } from "react";
import { confirmAction } from "@/components/confirm";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";
import type { Row } from "@/plugins/workspace/model";
import { draftRowReplyAction, rowActionAction, setCellAction } from "@/plugins/workspace/actions";
import { SuggestedActions } from "@/plugins/workspace/ui/suggested";
import type { AppViewProps } from "@/plugins/workspace/ui/app-view";
import { Dropdown, MenuItem } from "@/plugins/workspace/ui/kit";
import { MailReply } from "./MailReply";
import { NewInbox } from "./NewInbox";
import { groupThreads, snoozeUntil, type SnoozeOption, type Thread } from "../threads";

/**
 * The combined inbox: mails and chats from every source of the database in one list — a channel filter on top, the reading pane
 * beside it with the conversation, and a reply by what the channel is: a mail a draft you send yourself, a chat sent from here.
 */

const ICON: Record<string, string> = { Outlook: "✉️", Gmail: "📮", Teams: "🟣", WhatsApp: "🟢", Signal: "🔵" };
const MAIL = new Set(["Outlook", "Gmail"]);
type Msg = { key: string; name: string; at: string; preview: string; mine: boolean };

const when = (v: unknown) => {
  const d = v ? new Date(String(v)) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  return new Date().toDateString() === d.toDateString() ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString([], { day: "2-digit", month: "2-digit" });
};
const fromName = (v: unknown) => String(v ?? "").replace(/\s*<[^>]*>$/, "") || "?";

export default function InboxView({ data, rows, openRow, reload }: AppViewProps) {
  const t = useT();
  const [channel, setChannel] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [showSnoozed, setShowSnoozed] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const channelOf = (r: Row) => data.schema.properties.find((p) => p.id === "commchannel")?.options?.find((o) => o.id === r.cells.commchannel)?.name ?? "";
  const channels = useMemo(() => {
    const m = new Map<string, { all: number; unread: number }>();
    for (const r of rows) {
      const c = channelOf(r) || "?";
      const v = m.get(c) ?? { all: 0, unread: 0 };
      v.all++;
      if (r.cells.communread) v.unread++;
      m.set(c, v);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- channelOf reads data, which rows come with
  }, [rows, data]);
  // eslint-disable-next-line react-hooks/purity -- what is snoozed is so at the time it is drawn
  const now = Date.now();
  const visible = rows.filter((r) => (!channel || channelOf(r) === channel) && (!unreadOnly || r.cells.communread));
  // By conversation: one entry per thread; the snoozed ones are away (their own list: the 💤 chip).
  const grouped = useMemo(() => groupThreads(visible, now), [visible, now]);
  const asleep = useMemo(() => groupThreads(visible.filter((r) => Date.parse(String(r.cells.commsnooze ?? "")) > now).map((r) => ({ ...r, cells: { ...r.cells, commsnooze: undefined } })), now).threads, [visible, now]);
  const threads: Thread[] = showSnoozed ? asleep : grouped.threads;
  const list = threads.map((x) => x.head);
  const row = list.find((r) => r.id === picked) ?? list[0] ?? null;
  const thread = threads.find((x) => x.head.id === row?.id) ?? null;
  const unread = rows.filter((r) => r.cells.communread).length;
  const chip = (on: boolean) => `rounded-full border px-2.5 py-0.5 text-xs ${on ? "border-indigo-400 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-300" : "border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"}`;
  return (
    <div className="grid h-[70vh] min-h-96 grid-cols-[minmax(0,26rem)_minmax(0,1fr)] overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800" data-app-view="inbox">
      <div className="flex min-h-0 flex-col border-r border-zinc-200 dark:border-zinc-800">
        <div className="flex flex-wrap items-center gap-1 border-b border-zinc-100 px-3 py-1.5 dark:border-zinc-800">
          <button type="button" className={chip(!channel)} aria-pressed={!channel} onClick={() => setChannel("")}>
            {t("All")} {rows.length} {unread > 0 && <b className="text-indigo-600" title={t("{n} unread", { n: unread })}>· {unread}</b>}
          </button>
          {channels.map(([c, v]) => (
            <button key={c} type="button" className={chip(channel === c)} aria-pressed={channel === c} onClick={() => setChannel(channel === c ? "" : c)}>
              {ICON[c] ?? "•"} {c} <span className="text-zinc-400">{v.all}</span> {v.unread > 0 && <b className="text-indigo-600" title={t("{n} unread", { n: v.unread })}>· {v.unread}</b>}
            </button>
          ))}
          <span className="flex-1" />
          {(grouped.snoozed > 0 || showSnoozed) && (
            <button type="button" className={chip(showSnoozed)} aria-pressed={showSnoozed} onClick={() => setShowSnoozed(!showSnoozed)} title={t("Snoozed conversations")}>
              💤 {grouped.snoozed}
            </button>
          )}
          <label className="flex items-center gap-1 text-xs text-zinc-500">
            <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
            {t("Unread only")}
          </label>
          <NewInbox dbId={data.id} dataType="mail" />
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto" aria-label={t("Inbox")}>
          {threads.map((th) => {
            const r = th.head;
            return (
            <li key={r.id}>
              <button type="button" onClick={() => setPicked(r.id)} className={`block w-full border-b border-zinc-100 px-3 py-2 text-left dark:border-zinc-800 ${row?.id === r.id ? "bg-indigo-50 dark:bg-indigo-950/40" : "hover:bg-zinc-50 dark:hover:bg-zinc-900"}`}>
                <span className="flex items-baseline gap-2">
                  <span aria-hidden title={channelOf(r)}>{ICON[channelOf(r)] ?? "•"}</span>
                  <span className={`min-w-0 flex-1 truncate text-sm ${th.unread ? "font-semibold" : ""}`}>{fromName(r.cells.commfrom)}</span>
                  {th.count > 1 && <span className="shrink-0 rounded-full bg-zinc-100 px-1.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" title={t("{n} messages in this conversation", { n: th.count })}>{th.count}</span>}
                  <span className="shrink-0 text-xs text-zinc-400">{when(r.cells.commwhen)}</span>
                </span>
                <span className={`block truncate text-sm ${th.unread ? "font-medium text-indigo-700 dark:text-indigo-300" : ""}`}>{r.title}</span>
                <span className="block truncate text-xs text-zinc-500">{String(r.cells.commwhere ?? "")}</span>
              </button>
            </li>
            );
          })}
          {!list.length && <li className="p-4 text-sm text-zinc-500">{t("Nothing here.")}</li>}
        </ul>
      </div>
      <section className="min-w-0 overflow-y-auto p-4" aria-label={t("Reading pane")}>
        {row ? <Reading key={row.id} row={row} ids={thread?.ids ?? [row.id]} channel={channelOf(row)} data={data} openRow={openRow} reload={reload} /> : <p className="text-sm text-zinc-500">{t("Pick a message.")}</p>}
      </section>
    </div>
  );
}

/** One item opened: who, where, the conversation (a mail's or a WhatsApp / Signal chat's from Zeff's own copy; Teams: its text), suggestions, and a reply by channel. */
function Reading({ row, ids, channel, data, openRow, reload }: { row: Row; ids: number[]; channel: string; data: AppViewProps["data"]; openRow: (id: number) => void; reload: () => void }) {
  const t = useT();
  const conv = String(row.cells.commconv ?? "");
  const [thread, setThread] = useState<Msg[] | null>(null);
  useEffect(() => {
    let live = true;
    if (conv && !conv.startsWith("19:"))
      void fetch(`/api/mail/thread?conv=${encodeURIComponent(conv)}`)
        .then((r) => (r.ok ? r.json() : { messages: [] }))
        .then((j: { messages: Msg[] }) => live && setThread(j.messages));
    else void Promise.resolve().then(() => live && setThread([]));
    return () => {
      live = false;
    };
  }, [conv]);
  const link = typeof row.cells.srcurl === "string" ? row.cells.srcurl : "";
  const canReply = !!data.extras?.capabilities?.reply.includes(channel);
  const text = data.extras?.previews[row.id]?.map((l) => l.text).join("\n") ?? "";
  return (
    <article className="space-y-3">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">{row.title}</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {ICON[channel] ?? "•"} {channel} · {String(row.cells.commfrom ?? "")} · {when(row.cells.commwhen)} · {String(row.cells.commwhere ?? "")}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {link && (
            <a href={link} target="_blank" rel="noreferrer" className="btn btn-sm">
              ↗ {t("Open in {app}", { app: channel })}
            </a>
          )}
          <button type="button" className="btn btn-sm" onClick={() => openRow(row.id)}>
            ▤ {t("Open as row")}
          </button>
          <Dropdown label={`💤 ${t("Snooze")}`} className="btn btn-sm">
            {(close) =>
              (
                [
                  ["later", t("Later today")],
                  ["tomorrow", t("Tomorrow morning")],
                  ["week", t("Next week")],
                  ["", t("Wake up now")],
                ] as [SnoozeOption | "", string][]
              ).map(([k, label]) => (
                <MenuItem
                  key={k || "clear"}
                  onClick={async () => {
                    close();
                    const until = k ? snoozeUntil(k) : "";
                    for (const id of ids) await setCellAction(id, "commsnooze", until || null);
                    toast(k ? t("Snoozed — it comes back {when}.", { when: label.toLowerCase() }) : t("Awake again."), { action: k ? { label: t("Undo"), run: async () => { for (const id of ids) await setCellAction(id, "commsnooze", null); reload(); } } : undefined });
                    reload();
                  }}
                >
                  {label}
                </MenuItem>
              ))
            }
          </Dropdown>
          {!canReply && <span className="text-xs text-zinc-500" data-read-only>🔒 {t("Read-only — replying through {channel} isn't set up here.", { channel })}</span>}
        </div>
      </header>
      {typeof row.cells.filterwhy === "string" && row.cells.filterwhy && <p className="rounded bg-amber-50 px-2 py-1 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">⭐ {row.cells.filterwhy}</p>}
      {thread === null ? (
        <p className="text-sm text-zinc-400">…</p>
      ) : (
        <ol className="space-y-2">
          {(thread.length ? thread : [{ key: "row", name: fromName(row.cells.commfrom), at: when(row.cells.commwhen), preview: text || row.title, mine: !!row.cells.commmine }]).map((m) => (
            <li key={m.key} className={`rounded-lg border p-3 text-sm ${m.mine ? "border-indigo-200 bg-indigo-50/50 dark:border-indigo-900 dark:bg-indigo-950/20" : "border-zinc-200 dark:border-zinc-800"}`}>
              <p className="mb-1 flex gap-2 text-xs text-zinc-500">
                <span className="font-medium text-zinc-700 dark:text-zinc-300">{m.mine ? t("Me") : m.name}</span>
                <span>{m.at}</span>
              </p>
              <p className="whitespace-pre-wrap">{m.preview}</p>
            </li>
          ))}
        </ol>
      )}
      <SuggestedActions rowId={row.id} value={row.cells.rowactions} onDone={reload} />
      {canReply && MAIL.has(channel) && <MailReply key={row.id} rowId={row.id} account={channel} to={/<([^>]+)>/.exec(String(row.cells.commfrom ?? ""))?.[1] ?? ""} subject={/^(AW|RE|Re|Aw):/.test(row.title) ? row.title : `AW: ${row.title}`} />}
      {canReply && !MAIL.has(channel) && <ChatReply key={row.id} rowId={row.id} channel={channel} chat={String(row.cells.commwhere ?? "")} onSent={reload} />}
    </article>
  );
}

/** A reply in a chat (Teams, WhatsApp, Signal): written or drafted by the AI, read once more, then sent. */
function ChatReply({ rowId, channel, chat, onSent }: { rowId: number; channel: string; chat: string; onSent: () => void }) {
  const t = useT();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    const body = text.trim();
    if (!body || !confirmAction(t("Send to “{chat}” via {channel}?", { chat, channel }))) return;
    setBusy(true);
    const op = channel === "Teams" ? { type: "teams-message", to: chat, body } : channel === "WhatsApp" ? { type: "whatsapp-message", chat, body } : { type: "signal-message", chat, body };
    const r = await rowActionAction(rowId, op);
    setBusy(false);
    if (!r.ok) return void toast(r.error, { tone: "error" });
    setText("");
    toast(t("Sent."), { tone: "ok" });
    onSent();
  };
  return (
    <form
      className="flex gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800"
      data-chat-reply
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <textarea className="input min-h-10 flex-1 resize-none text-sm" rows={2} value={text} readOnly={busy} placeholder={t("Reply …")} aria-label={t("Reply")} onChange={(e) => setText(e.target.value)} />
      <div className="flex flex-col gap-1">
        <button
          type="button"
          className="btn btn-sm"
          disabled={busy}
          title={t("Draft with AI")}
          onClick={async () => {
            setBusy(true);
            const r = await draftRowReplyAction(rowId);
            setBusy(false);
            if (!r.ok) return void toast(r.error, { tone: "error" });
            setText(r.text);
          }}
        >
          ✨
        </button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !text.trim()}>
          {busy ? "…" : t("Send")}
        </button>
      </div>
    </form>
  );
}
