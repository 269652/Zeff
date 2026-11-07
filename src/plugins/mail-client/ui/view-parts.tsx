"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { setCellAction } from "@/plugins/workspace/actions";
import type { Row } from "@/plugins/workspace/model";
import type { AppViewProps, PartProps, ViewAppModule } from "@/plugins/workspace/ui/app-view";
import { Dropdown, MenuItem } from "@/plugins/workspace/ui/kit";
import { SuggestedActions } from "@/plugins/workspace/ui/suggested";
import { KnowPanel } from "@/plugins/know/ui/KnowPanel";
import { snoozeUntil, type SnoozeOption } from "../threads";
import { chatAppData, inboxAppData, mailAppData, type Current, type MailInput, type Msg } from "../view-data";
import { ChatReply } from "./ChatReply";
import { MailReply } from "./MailReply";
import { NewInbox } from "./NewInbox";
import { archiveReadAction, archiveRowsAction, markOpenedReadAction } from "@/plugins/imap-mail/open-actions";

/** How long a mail is looked at before it counts as read. */
const OPEN_READ_MS = 1500;

/**
 * The mail client's views, client side: what their templates read as app.* (view-data.ts, worked out of the rows and the view's
 * state), and the parts they are built of where the language's tags aren't enough — the conversation fetched, the reply, the
 * suggestions, snooze, a chat's bubbles, the texts of a list item that aren't properties.
 */

/** The app data of one of the views, worked out again when the rows or the view's state change. */
const appData = (compute: (v: MailInput) => Record<string, unknown>) =>
  function useMailData(props: AppViewProps, state: Record<string, string>) {
    const extras = props.data.extras;
    const schema = props.data.schema;
    // (What is snoozed is so at the time it is worked out.)
    const data = useMemo(
      () => compute({ rows: props.rows, props: schema.properties, state, previews: extras?.previews, reply: extras?.capabilities?.reply ?? [], now: Date.now() }),
      [props.rows, schema, state, extras],
    );
    // The one opened, still unread, looked at for a moment (not just passed while going through the list): read — in Zeff, and for an
    // IMAP account on its server (the account's setting "mark read when opened").
    const current = data.current as { id: number; ids?: number[] } | null | undefined;
    const ids = current ? (current.ids ?? [current.id]) : [];
    const unread = ids.some((id) => {
      const cells = props.rows.find((r) => r.id === id)?.cells;
      return !!(cells?.communread || cells?.mailunread);
    });
    // (Only what you picked: the newest, picked by itself when the view opens, isn't read for being shown.)
    const key = unread && state.selected ? ids.join(",") : "";
    const reload = props.reload;
    useEffect(() => {
      if (!key) return;
      const timer = setTimeout(() => {
        void markOpenedReadAction(key.split(",").map(Number)).then((r) => r.ok && r.marked > 0 && reload());
      }, OPEN_READ_MS);
      return () => clearTimeout(timer);
    }, [key, reload]);
    return { data, reload: () => {} };
  };

const currentOf = (p: PartProps) => (p.app.current as Current | null | undefined) ?? null;

/** Archive: the conversation picked out of the inbox — on its mail server too. */
function ArchivePart(p: PartProps) {
  const t = useT();
  const current = currentOf(p) as (Current & { ids?: number[] }) | null;
  const [busy, setBusy] = useState(false);
  if (!current) return null;
  const archive = async () => {
    setBusy(true);
    const r = await archiveRowsAction(current.ids ?? [current.id]);
    setBusy(false);
    if (!r.ok) return toast(r.error, { tone: "error" });
    if (r.failed.length) return toast(r.failed.join(" · "), { tone: "error" });
    p.setState("selected", "");
    p.reload();
    toast(t("Archived."));
  };
  return (
    <button type="button" className="btn btn-sm print:hidden" disabled={busy} onClick={() => void archive()} title={t("Out of the inbox — on the mail server too")}>
      🗄 {busy ? t("Archiving …") : t("Archive")}
    </button>
  );
}

/** Archive what is read: the IMAP / POP3 inboxes' read conversations, at once. */
function ArchiveReadPart(p: PartProps) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const any = p.rows.some((r) => String(r.cells.commconv ?? "").startsWith("imap:"));
  if (!any) return null;
  const go = async () => {
    if (!window.confirm(t("Archive every read conversation of your mailboxes' inboxes (IMAP / POP3)?"))) return;
    setBusy(true);
    const r = await archiveReadAction();
    setBusy(false);
    if (!r.ok) return toast(r.error, { tone: "error" });
    p.reload();
    toast(r.failed.length ? r.failed.join(" · ") : t("{n} archived.", { n: r.archived }), { tone: r.failed.length ? "error" : "ok" });
  };
  return (
    <button type="button" className="rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 print:hidden dark:hover:bg-zinc-800" disabled={busy} onClick={() => void go()}>
      {busy ? t("Archiving …") : t("Archive read")}
    </button>
  );
}

/** + New inbox (a database of the plugin's templates under this one). */
function NewInboxPart(p: PartProps) {
  return (
    <span className="print:hidden">
      <NewInbox dbId={p.data.id} dataType={p.attrs.type === "message" ? "message" : "mail"} />
    </span>
  );
}

/** A list item's text that isn't a property (app.texts by row): the sender's name, a preview — or a thread's size as a badge. */
function TextPart(p: PartProps) {
  const t = useT();
  const texts = (p.app.texts as Record<number, Record<string, unknown>> | undefined) ?? {};
  const v = p.rowId != null ? texts[p.rowId]?.[p.attrs.field] : undefined;
  if (p.attrs.field === "count") {
    const n = Number(v) || 0;
    return n > 1 ? (
      <span className="shrink-0 rounded-full bg-zinc-100 px-1.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" title={t("{n} messages in this conversation", { n })}>
        {n}
      </span>
    ) : null;
  }
  const s = typeof v === "string" ? v : "";
  if (p.attrs.field === "preview") return <>{s}</>;
  return <span className={`min-w-0 flex-1 truncate text-sm ${p.attrs.strong === "true" ? "font-semibold" : ""}`}>{s}</span>;
}

/** The conversation of the one picked, oldest first — fetched (a mail's, a WhatsApp / Signal chat's), else the message itself. */
function ThreadPart(p: PartProps) {
  const c = currentOf(p);
  if (!c) return null;
  return <Thread key={c.id} conv={c.conv} fetch={c.fetch} fallback={c.fallback} />;
}

function Thread({ conv, fetch: load, fallback }: { conv: string; fetch: boolean; fallback: Msg }) {
  const t = useT();
  const [thread, setThread] = useState<Msg[] | null>(load ? null : []);
  useEffect(() => {
    if (!load) return;
    let live = true;
    void fetch(`/api/mail/thread?conv=${encodeURIComponent(conv)}`)
      .then((r) => (r.ok ? r.json() : { messages: [] }))
      .then((j: { messages: Msg[] }) => live && setThread(j.messages));
    return () => {
      live = false;
    };
  }, [conv, load]);
  if (thread === null) return <p className="text-sm text-zinc-400">…</p>;
  return (
    <ol className="space-y-2">
      {(thread.length ? thread : [fallback]).map((m) => (
        <li key={m.key} className={`rounded-lg border p-3 text-sm ${m.mine ? "border-indigo-200 bg-indigo-50/50 dark:border-indigo-900 dark:bg-indigo-950/20" : "border-zinc-200 dark:border-zinc-800"}`}>
          <p className="mb-1 flex gap-2 text-xs text-zinc-500">
            <span className="font-medium text-zinc-700 dark:text-zinc-300">{m.mine ? t("Me") : m.name}</span>
            <span>{m.at}</span>
          </p>
          <p className="whitespace-pre-wrap">{m.preview}</p>
        </li>
      ))}
    </ol>
  );
}

/** The AI's suggested actions (a reply, a follow-up) for the one picked. */
function SuggestedPart(p: PartProps) {
  const a = currentOf(p)?.actions;
  if (!a) return null;
  return <SuggestedActions key={a.rowId} rowId={a.rowId} value={a.value} onDone={p.reload} />;
}

/** What you should know about the one picked (the know plugin): its people, what is open with them, what it is about. */
function KnowPart(p: PartProps) {
  const c = currentOf(p);
  return c?.id ? <KnowPanel key={c.id} row={c.id} compact /> : null;
}

/** The reply by what the one picked is: a mail a draft you send yourself, a chat sent from here. */
function ReplyPart(p: PartProps) {
  const c = currentOf(p);
  const r = c?.reply;
  if (!c || !r) return null;
  if (r.kind === "mail") return <MailReply key={c.id} rowId={c.id} account={r.account} to={r.to} subject={r.subject} />;
  return <ChatReply key={String(c.key ?? c.id)} rowId={r.rowId} channel={r.channel} chat={r.chat} onSent={p.reload} bar={p.attrs.bar === "true"} />;
}

/** 💤 Snooze: the whole thread away until a time — or awake again. */
function SnoozePart(p: PartProps) {
  const t = useT();
  const c = currentOf(p);
  const ids = (c?.ids as number[] | undefined) ?? [];
  if (!c) return null;
  const options: [SnoozeOption | "", string][] = [
    ["later", t("Later today")],
    ["tomorrow", t("Tomorrow morning")],
    ["week", t("Next week")],
    ["", t("Wake up now")],
  ];
  return (
    <Dropdown label={`💤 ${t("Snooze")}`} className="btn btn-sm print:hidden">
      {(close) =>
        options.map(([k, label]) => (
          <MenuItem
            key={k || "clear"}
            onClick={async () => {
              close();
              const until = k ? snoozeUntil(k) : "";
              for (const id of ids) await setCellAction(id, "commsnooze", until || null);
              const undo = async () => {
                for (const id of ids) await setCellAction(id, "commsnooze", null);
                p.reload();
              };
              toast(k ? t("Snoozed — it comes back {when}.", { when: label.toLowerCase() }) : t("Awake again."), { action: k ? { label: t("Undo"), run: undo } : undefined });
              p.reload();
            }}
          >
            {label}
          </MenuItem>
        ))
      }
    </Dropdown>
  );
}

/** The chat picked as bubbles, yours on the right — opened at its newest message (the bottom), as a chat does; a click opens one. */
function MessagesPart(p: PartProps) {
  const list = (currentOf(p)?.messages as Row[] | undefined) ?? [];
  const scroller = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [list.length]);
  const time = (v: unknown) => {
    const d = v ? new Date(String(v)) : null;
    return d && !Number.isNaN(d.getTime()) ? d.toLocaleString([], { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
  };
  if (!list.length) return null;
  return (
    <ol ref={scroller} className="max-h-[60vh] min-h-0 flex-1 space-y-2 overflow-y-auto py-2">
      {list.map((r) => (
        <li key={r.id} className={`flex ${r.cells.msgmine ? "justify-end" : ""}`}>
          <button type="button" onClick={() => p.openRow(r.id)} className={`max-w-[75%] rounded-2xl px-3 py-2 text-left text-sm ${r.cells.msgmine ? "bg-indigo-600 text-white" : "bg-zinc-100 dark:bg-zinc-800"}`}>
            {!r.cells.msgmine && <span className="block text-xs font-medium opacity-70">{String(r.cells.msgsender ?? "")}</span>}
            <span className="block whitespace-pre-wrap">{r.title}</span>
            <span className="block text-right text-[10px] opacity-60">{time(r.cells.msgsent)}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

const shared = { "mail.new-inbox": NewInboxPart, "mail.thread": ThreadPart, "mail.suggested": SuggestedPart, "mail.know": KnowPart, "mail.reply": ReplyPart };

export const MAIL: ViewAppModule = { parts: { ...shared, "mail.text": TextPart }, useAppData: appData(mailAppData) };
export const CHAT: ViewAppModule = { parts: { ...shared, "chat.messages": MessagesPart }, useAppData: appData(chatAppData) };
export const INBOX: ViewAppModule = { parts: { ...shared, "mail.text": TextPart, "inbox.snooze": SnoozePart,
    "inbox.archive": ArchivePart,
    "inbox.archive-read": ArchiveReadPart }, useAppData: appData(inboxAppData) };
