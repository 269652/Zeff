import type { Property, Row } from "@/plugins/workspace/model";
import { groupThreads } from "./threads";

/**
 * What the mail client's templates read as app.* (view-template.ts): the list each shows (mails newest first, a chat by its last
 * message, the inbox by conversation), what its items show that isn't a property (a sender's name, a preview, a thread's size), and
 * the one picked worked out for its reading pane — its link, whether it can be answered here and how. Client-safe; pure.
 */

/** A message of a conversation as the reading pane shows it. */
export type Msg = { key: string; name: string; at: string; preview: string; mine: boolean };
/** How the one picked is answered: a mail drafted, a chat sent from here. */
export type Reply = { kind: "mail"; account: string; to: string; subject: string } | { kind: "chat"; rowId: number; channel: string; chat: string };
/** The one picked, for the parts of its reading pane. */
export type Current = {
  id: number;
  /** The conversation it is in (fetched from /api/mail/thread when `fetch`), else `fallback` alone. */
  conv: string;
  fetch: boolean;
  fallback: Msg;
  /** The row whose suggested actions are shown. */
  actions: { rowId: number; value: unknown } | null;
  reply: Reply | null;
  [k: string]: unknown;
};

export type MailInput = { rows: Row[]; props: Property[]; state: Record<string, string>; previews?: Record<number, { text: string }[]>; reply?: string[]; now?: number };

export const ICON: Record<string, string> = { Outlook: "✉️", Gmail: "📮", "E-Mail": "📧", Teams: "🟣", WhatsApp: "🟢", Signal: "🔵" };
const MAIL = new Set(["Outlook", "Gmail", "E-Mail"]);

const optName = (props: Property[], prop: string, v: unknown) => props.find((p) => p.id === prop)?.options?.find((o) => o.id === v)?.name ?? "";
const str = (v: unknown) => (typeof v === "string" ? v : "");
/** "Anna Berg <anna@x.de>" → "Anna Berg". */
export const fromName = (v: unknown) => String(v ?? "").replace(/\s*<[^>]*>$/, "") || "?";
const emailOf = (v: unknown) => /<([^>]+)>/.exec(String(v ?? ""))?.[1] ?? "";
const answer = (title: string) => (/^(AW|RE|Re|Aw):/.test(title) ? title : `AW: ${title}`);
const pad = (n: number) => String(n).padStart(2, "0");
/** Its time today, else its day — as the templates write it. */
export function when(v: unknown, now = Date.now()): string {
  const d = v ? new Date(String(v)) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  return new Date(now).toDateString() === d.toDateString() ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`;
}
const newest = (prop: string) => (a: Row, b: Row) => String(b.cells[prop] ?? "").localeCompare(String(a.cells[prop] ?? ""));
const previewOf = (v: MailInput, id: number, sep: string) => v.previews?.[id]?.map((l) => l.text).join(sep) ?? "";
/** The row picked (state.selected), else the first of the list. */
const picked = (v: MailInput, first: string) => {
  const sel = v.state.selected ?? first;
  return v.rows.find((r) => String(r.id) === sel) ?? null;
};
const actionsOf = (r: Row | undefined) => (r && typeof r.cells.rowactions === "string" && r.cells.rowactions ? { rowId: r.id, value: r.cells.rowactions } : null);

/** The mail client: the mails newest first (unread only on state.unread), and the one picked. */
export function mailAppData(v: MailInput): Record<string, unknown> {
  const reply = v.reply ?? [];
  const mails = v.rows.filter((r) => v.state.unread !== "true" || r.cells.mailunread).sort(newest("mailreceived"));
  const first = mails[0] ? String(mails[0].id) : "";
  const row = picked(v, first);
  let current: Current | null = null;
  if (row) {
    const account = optName(v.props, "mailaccount", row.cells.mailaccount) || "Outlook";
    const conv = str(row.cells.mailconv);
    current = {
      id: row.id,
      gmail: account === "Gmail",
      link: str(row.cells.srcurl),
      why: str(row.cells.filterwhy),
      canReply: reply.includes(account),
      conv,
      fetch: !!conv,
      fallback: { key: "row", name: String(row.cells.mailfrom ?? ""), at: when(row.cells.mailreceived, v.now), preview: previewOf(v, row.id, "\n"), mine: false },
      actions: actionsOf(row),
      reply: { kind: "mail", account, to: emailOf(row.cells.mailfrom), subject: answer(row.title) },
    };
  }
  return {
    mails,
    first,
    unread: v.rows.filter((r) => r.cells.mailunread).length,
    texts: Object.fromEntries(v.rows.map((r) => [r.id, { from: fromName(r.cells.mailfrom), preview: previewOf(v, r.id, " ") }])),
    current,
  };
}

/** The chat: a conversation per chat (msgconv, else the chat's name), the newest first, each by its last message; the one picked. */
export function chatAppData(v: MailInput): Record<string, unknown> {
  const reply = v.reply ?? [];
  const keyOf = (r: Row) => String(r.cells.msgconv ?? r.cells.msgchat ?? r.id);
  const byKey = new Map<string, Row[]>();
  for (const r of v.rows) byKey.set(keyOf(r), [...(byKey.get(keyOf(r)) ?? []), r]);
  const chats = [...byKey.entries()]
    .map(([key, list]) => ({ key, list: [...list].sort((a, b) => String(a.cells.msgsent ?? "").localeCompare(String(b.cells.msgsent ?? ""))) }))
    .sort((a, b) => String(b.list.at(-1)?.cells.msgsent ?? "").localeCompare(String(a.list.at(-1)?.cells.msgsent ?? "")));
  const first = chats[0] ? String(chats[0].list.at(-1)!.id) : "";
  const row = picked(v, first);
  // (An older message picked — the list picks a chat by its last one, which moves on: the chat it is in.)
  const chat = row ? chats.find((c) => c.key === keyOf(row)) : undefined;
  let current: Current | null = null;
  if (chat) {
    const last = chat.list.at(-1)!;
    const channel = optName(v.props, "msgchannel", last.cells.msgchannel);
    const name = String(last.cells.msgchat ?? "");
    current = {
      id: last.id,
      key: chat.key,
      name,
      channel,
      icon: ICON[channel] ?? "💬",
      link: chat.list.map((r) => str(r.cells.srcurl)).find(Boolean) ?? "",
      canReply: reply.includes(channel),
      messages: chat.list,
      conv: "",
      fetch: false,
      fallback: { key: "row", name: "", at: "", preview: "", mine: false },
      // The newest message with suggestions (a reply, a follow-up): its buttons over the reply.
      actions: actionsOf([...chat.list].reverse().find((r) => actionsOf(r))),
      reply: reply.includes(channel) ? { kind: "chat", rowId: last.id, channel, chat: name } : null,
    };
  }
  return { chats: chats.map((c) => c.list.at(-1)!), first, current };
}

const clean = (s: string) => s.replace(/[,:]/g, " ");

/** The combined inbox: a thread per conversation of the channel picked (state.channel; unread only: state.unread), the snoozed ones apart (state.snoozed), the one picked. */
export function inboxAppData(v: MailInput): Record<string, unknown> {
  const reply = v.reply ?? [];
  const now = v.now ?? Date.now();
  const channelOf = (r: Row) => optName(v.props, "commchannel", r.cells.commchannel);
  const counts = new Map<string, { all: number; unread: number }>();
  for (const r of v.rows) {
    const c = channelOf(r) || "?";
    const x = counts.get(c) ?? { all: 0, unread: 0 };
    x.all++;
    if (r.cells.communread) x.unread++;
    counts.set(c, x);
  }
  const unread = v.rows.filter((r) => r.cells.communread).length;
  const channel = v.state.channel ?? "";
  const visible = v.rows.filter((r) => (!channel || channelOf(r) === channel) && (v.state.unread !== "true" || r.cells.communread));
  const grouped = groupThreads(visible, now);
  const showSnoozed = v.state.snoozed === "true";
  // The snoozed: their own list, grouped as if awake.
  const asleep = () => groupThreads(visible.filter((r) => Date.parse(String(r.cells.commsnooze ?? "")) > now).map((r) => ({ ...r, cells: { ...r.cells, commsnooze: undefined } })), now).threads;
  const threads = showSnoozed ? asleep() : grouped.threads;
  const first = threads[0] ? String(threads[0].head.id) : "";
  const row = picked(v, first);
  let current: Current | null = null;
  if (row) {
    const ch = channelOf(row);
    const conv = str(row.cells.commconv);
    // The whole conversation (snoozed at once), whatever the list shows of it.
    const ids = conv ? v.rows.filter((r) => r.cells.commconv === conv).map((r) => r.id) : [row.id];
    const canReply = reply.includes(ch);
    current = {
      id: row.id,
      channel: ch,
      icon: ICON[ch] ?? "•",
      link: str(row.cells.srcurl),
      why: str(row.cells.filterwhy),
      canReply,
      // (An IMAP / POP3 account's mail: archived through Zeff.)
      archivable: String(row.cells.commconv ?? "").startsWith("imap:"),
      ids,
      conv,
      // (A Teams chat: its own text; a mail's or a WhatsApp / Signal chat's from Zeff's copy.)
      fetch: !!conv && !conv.startsWith("19:"),
      fallback: { key: "row", name: fromName(row.cells.commfrom), at: when(row.cells.commwhen, now), preview: previewOf(v, row.id, "\n") || row.title, mine: !!row.cells.commmine },
      actions: actionsOf(row),
      reply: !canReply ? null : MAIL.has(ch) ? { kind: "mail", account: ch, to: emailOf(row.cells.commfrom), subject: answer(row.title) } : { kind: "chat", rowId: row.id, channel: ch, chat: String(row.cells.commwhere ?? "") },
    };
  }
  return {
    threads: threads.map((x) => x.head),
    first,
    unreadIds: threads.filter((x) => x.unread > 0).map((x) => x.head.id),
    texts: Object.fromEntries(threads.map((x) => [x.head.id, { from: fromName(x.head.cells.commfrom), count: x.count, preview: previewOf(v, x.head.id, " ") }])),
    total: v.rows.length,
    allUnread: unread ? ` · ${unread}` : "",
    channelOptions: [...counts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([c, x]) => `${clean(c)}:${ICON[c] ?? "•"} ${clean(c)} ${x.all}${x.unread ? ` · ${x.unread}` : ""}`)
      .join(", "),
    // (For tabs: "value:Label:count" — the count is what is unread, none when nothing is.)
    unreadCount: unread || "",
    channelTabs: [...counts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([c, x]) => `${clean(c)}:logo-${clean(c).toLowerCase().replace(/\s+/g, "-")} ${clean(c)}${x.unread ? `:${x.unread}` : ""}`)
      .join(", "),
    snoozed: grouped.snoozed,
    snoozedToggle: grouped.snoozed > 0 || showSnoozed,
    current,
  };
}

/** What app.* holds — the AI and the language's help read them. */
export const MAIL_APP_DATA =
  "app.mails (the mails as rows, newest first; unread only when state.unread is \"true\"), app.first (the newest's id — picked to start with), app.unread (how many unread), app.current (the one picked: id, gmail, link, why, canReply, conv), app.texts (by row id: from, preview — the parts show them). State: state.selected, state.unread.";
export const CHAT_APP_DATA =
  "app.chats (a row per chat — its last message — newest first), app.first, app.current (the chat picked: id of its last message, name, channel, icon, link, canReply, messages). State: state.selected.";
export const INBOX_APP_DATA =
  "app.threads (a row per conversation — its newest message — newest first), app.first, app.unreadIds (the threads with something unread: contains(app.unreadIds, id)), app.texts (by row id: from, count), app.total, app.allUnread (\" · n\" or \"\"), app.channelOptions (the channels as tabs' options with their counts), app.snoozed (how many threads are snoozed), app.snoozedToggle, app.current (the one picked: id, channel, icon, link, why, canReply, ids of its thread). State: state.selected, state.channel, state.unread, state.snoozed.";
