/**
 * Open loops read by rule (the loops plugin) — no AI: in the chats (WhatsApp, Signal), the mail threads (Gmail, which keeps what you
 * sent; Outlook only from your people), Teams and the Jira comments, what was asked of you since your last word there (a question, a
 * request to review, approve or sign, a comment addressed to you), and your own question that is the last word of its chat. A loop
 * read so closes by itself: the next answer of the right side takes it off. Server only.
 */
import { getSqlite } from "@/db";
import { WA_SYSTEM } from "@/lib/mail/store";
import { getPerson, listPeople } from "@/plugins/people/store";
import { myNames } from "@/plugins/people/pulse";
import { makeResolver, type Resolver } from "@/plugins/timeline/refs";
import { addressedTo, isOverdue, isQuestion, isRequest, type Loop, type LoopDirection, type LoopKind } from "./shared";
import { flatSlice } from "@/lib/text";

/** How far back the rules read. */
export const WINDOW_DAYS = 21;
/** At most so many loops from one chat or thread (its newest). */
const PER_THREAD = 3;

const all = <T>(sql: string, ...args: unknown[]): T[] => {
  try {
    return getSqlite().prepare(sql).all(...args) as T[];
  } catch {
    return [];
  }
};

/** You: your names (lower case) and your handles (Jira usernames of the profile that is you). */
export function whoAmI(): { names: string[]; handles: string[] } {
  const names = myNames();
  const set = new Set(names);
  const handles = listPeople()
    .filter((p) => set.has(p.name.toLowerCase()))
    .flatMap((p) => p.accounts.map((a) => a.value.toLowerCase()));
  return { names, handles };
}


type Draft = Omit<Loop, "overdue" | "state" | "closedBy" | "closedAt" | "closeQuote" | "closeRef" | "proposal" | "snoozedUntil" | "origin" | "confirmed" | "confidence" | "due">;

function finish(d: Draft, now: Date): Loop {
  const l: Loop = { ...d, origin: "rule", confirmed: true, confidence: 1, due: "", overdue: false, state: "open", closedBy: null, closedAt: null, closeQuote: "", closeRef: "", proposal: null, snoozedUntil: null };
  l.overdue = isOverdue(l, now);
  return l;
}

const kindOf = (text: string, fallback: LoopKind | null): LoopKind | null => (isRequest(text) ? "request" : isQuestion(text) ? "question" : fallback);
const nameOf = (r: Resolver, id: number | null, fallback: string) => (id ? (getPerson(id)?.name ?? fallback) : fallback);

/** Chats and mail threads: what was asked of you since your last word, and your question nobody answered. */
function fromMail(r: Resolver, since: string, now: Date): Loop[] {
  type M = { key: string; conv_id: string; folder: string; from_name: string | null; from_email: string | null; subject: string; preview: string; at: string; is_group: number | null; to_me: number | null; resolved_at: string | null };
  const rows = all<M>("select key, conv_id, folder, from_name, from_email, subject, preview, received_at at, is_group, to_me, resolved_at from emails where received_at >= ? and folder != 'Notifications' order by received_at, key", since);
  const byConv = new Map<string, M[]>();
  for (const m of rows) {
    if (m.conv_id.startsWith("wa:") && WA_SYSTEM.test(m.preview.trim())) continue;
    const list = byConv.get(m.conv_id);
    if (list) list.push(m);
    else byConv.set(m.conv_id, [m]);
  }
  const out: Loop[] = [];
  for (const [conv, msgs] of byConv) {
    const chat = conv.startsWith("wa:") || conv.startsWith("sg:");
    const gmail = conv.startsWith("gmail:");
    // (Gmail and an IMAP mailbox keep what you sent: a thread you wrote in is known there.)
    const keepsSent = gmail || conv.startsWith("imap:");
    const source = conv.startsWith("wa:") ? "whatsapp" : conv.startsWith("sg:") ? "signal" : gmail ? "gmail" : conv.startsWith("imap:") ? "imap" : "mail";
    const chatName = chat ? conv.slice(3) : "";
    const mine = (m: M) => m.from_name === "Ich";
    // The app's own account (WhatsApp's tips) — not a conversation.
    if (chat && msgs.every((m) => !mine(m)) && msgs[msgs.length - 1].subject === msgs[msgs.length - 1].folder) continue;
    const group = msgs.some((m) => !!m.is_group);
    const spoke = msgs.some(mine);
    const href = (m: M) => (chat ? `/mail?${new URLSearchParams({ channel: conv.startsWith("wa:") ? "whatsapp" : "signal", open: conv })}` : `/mail?q=${encodeURIComponent(m.subject)}`);
    let lastMine = -1;
    msgs.forEach((m, i) => mine(m) && (lastMine = i));
    const asked: Loop[] = [];
    for (const m of msgs.slice(lastMine + 1)) {
      if (mine(m) || m.resolved_at) continue;
      if (chat && group && !m.to_me) continue;
      const sender = r.person(m.from_email) ?? r.person(m.from_name);
      const owner = chat ? r.person(chatName) : null;
      const personId = chat && !group ? (owner ?? sender) : sender;
      // A mail is a loop when it is a conversation: from one of your people, or a thread you wrote in.
      if (!chat && !personId && !(keepsSent && spoke)) continue;
      const text = chat ? m.preview : `${m.subject} — ${m.preview}`;
      const kind = kindOf(text, null);
      if (!kind) continue;
      asked.push(finish({ ref: `q:mail:${m.key}`, kind, direction: "mine", personId, who: nameOf(r, personId, (chat && !group ? chatName : m.from_name) || chatName || "?"), text: flatSlice(text, 300), quote: flatSlice(m.preview, 300), at: m.at, sourceRef: `mail:${m.key}`, source, href: href(m) }, now));
    }
    out.push(...asked.slice(-PER_THREAD));
    // Your question as the last word of a conversation (not in a group: anyone may answer there).
    const last = msgs[msgs.length - 1];
    if (last && mine(last) && !group && (isQuestion(last.preview) || isRequest(last.preview))) {
      const other = [...msgs].reverse().find((m) => !mine(m));
      const personId = chat ? r.person(chatName) : other ? (r.person(other.from_email) ?? r.person(other.from_name)) : null;
      if (chat || personId || other) {
        const kind = kindOf(last.preview, "question")!;
        out.push(finish({ ref: `q:mail:${last.key}`, kind, direction: "theirs", personId, who: nameOf(r, personId, chatName || other?.from_name || last.subject), text: flatSlice(chat ? last.preview : `${last.subject} — ${last.preview}`, 300), quote: flatSlice(last.preview, 300), at: last.at, sourceRef: `mail:${last.key}`, source, href: href(last) }, now));
      }
    }
  }
  return out;
}

/** Teams: chats to you and mentions of you asking something since your last word there; your question as a chat's last word. */
function fromTeams(r: Resolver, since: string, now: Date, me: Set<string>): Loop[] {
  type M = { key: string; kind: string; mention_type: string | null; conversation_id: string; reply_chain_id: string | null; place: string | null; sender_name: string | null; sender_id: string | null; at: string; text: string; link: string; resolved_at: string | null };
  const rows = all<M>("select key, kind, mention_type, conversation_id, reply_chain_id, place, sender_name, sender_id, sent_at at, text, link, resolved_at from teams_messages where sent_at >= ? order by sent_at, key", since);
  const byThread = new Map<string, M[]>();
  for (const m of rows) {
    const k = m.kind === "mention" && m.reply_chain_id ? `${m.conversation_id}|${m.reply_chain_id}` : m.conversation_id;
    const list = byThread.get(k);
    if (list) list.push(m);
    else byThread.set(k, [m]);
  }
  const out: Loop[] = [];
  for (const msgs of byThread.values()) {
    const theirIds = new Set(msgs.filter((m) => m.kind === "pm" && m.sender_id).map((m) => m.sender_id!));
    // You by your name; without one known, Teams's own hint: a chat line not from the other side of a 1:1 chat.
    const mine = (m: M) => (me.size ? me.has((m.sender_name ?? "").trim().toLowerCase()) : m.kind !== "pm" && m.kind !== "mention" && !!m.sender_id && !theirIds.has(m.sender_id));
    let lastMine = -1;
    msgs.forEach((m, i) => mine(m) && (lastMine = i));
    const asked: Loop[] = [];
    for (const m of msgs.slice(lastMine + 1)) {
      if (mine(m) || m.resolved_at) continue;
      if (m.kind !== "pm" && !(m.kind === "mention" && (m.mention_type === "person" || !m.mention_type))) continue;
      const kind = kindOf(m.text, null);
      if (!kind) continue;
      const personId = r.person(m.sender_name);
      asked.push(finish({ ref: `q:teams:${m.key}`, kind, direction: "mine", personId, who: nameOf(r, personId, m.sender_name ?? "Teams"), text: flatSlice(m.text, 300), quote: flatSlice(m.text, 300), at: m.at, sourceRef: `teams:${m.key}`, source: "teams", href: m.link }, now));
    }
    out.push(...asked.slice(-PER_THREAD));
    const last = msgs[msgs.length - 1];
    if (last && mine(last) && (isQuestion(last.text) || isRequest(last.text)) && msgs.some((m) => m.kind === "pm")) {
      const other = [...msgs].reverse().find((m) => !mine(m));
      const personId = r.person(other?.sender_name);
      out.push(finish({ ref: `q:teams:${last.key}`, kind: kindOf(last.text, "question")!, direction: "theirs", personId, who: nameOf(r, personId, other?.sender_name ?? (last.place ?? "Teams").replace(/^Chat with /, "")), text: flatSlice(last.text, 300), quote: flatSlice(last.text, 300), at: last.at, sourceRef: `teams:${last.key}`, source: "teams", href: last.link }, now));
    }
  }
  return out;
}

/** Jira: comments addressed to you (or asking on your tickets) since your last comment on the ticket; your question nobody answered. */
function fromJira(r: Resolver, since: string, now: Date, me: { names: string[]; handles: string[] }): Loop[] {
  type C = { id: string; ticket: string; author: string; body: string; at: string; mine: number | null; category: string | null; url: string | null };
  const rows = all<C>("select c.id, c.ticket, c.author, c.body, c.at, t.mine, t.status_category category, t.url from jira_comments c left join jira_tickets t on t.key = c.ticket where c.at >= ? order by c.at, c.id", since);
  const names = new Set(me.names);
  const handles = new Set(me.handles);
  const isMe = (a: string) => names.has(a.trim().toLowerCase()) || handles.has(a.trim().toLowerCase());
  const byTicket = new Map<string, C[]>();
  for (const c of rows) {
    const list = byTicket.get(c.ticket);
    if (list) list.push(c);
    else byTicket.set(c.ticket, [c]);
  }
  const out: Loop[] = [];
  for (const [ticket, cs] of byTicket) {
    if (cs[0].category === "done") continue;
    let lastMine = -1;
    cs.forEach((c, i) => isMe(c.author) && (lastMine = i));
    const href = cs[0].url ?? "";
    const asked: Loop[] = [];
    for (const c of cs.slice(lastMine + 1)) {
      if (isMe(c.author)) continue;
      const to = addressedTo(c.body, me.names, me.handles);
      const kind = kindOf(c.body, to ? "mention" : null);
      if (!kind || !(to || c.mine)) continue;
      const personId = r.person(c.author);
      asked.push(finish({ ref: `q:jira:${c.id}`, kind, direction: "mine", personId, who: nameOf(r, personId, c.author), text: flatSlice(`${ticket}: ${c.body}`, 300), quote: flatSlice(c.body, 300), at: c.at, sourceRef: `jira-comment:${c.id}`, source: "jira", href }, now));
    }
    out.push(...asked.slice(-PER_THREAD));
    const last = cs[cs.length - 1];
    if (last && isMe(last.author) && isQuestion(last.body)) {
      const other = [...cs].reverse().find((c) => !isMe(c.author));
      const personId = other ? r.person(other.author) : null;
      out.push(finish({ ref: `q:jira:${last.id}`, kind: kindOf(last.body, "question")!, direction: "theirs", personId, who: nameOf(r, personId, other?.author ?? ticket), text: flatSlice(`${ticket}: ${last.body}`, 300), quote: flatSlice(last.body, 300), at: last.at, sourceRef: `jira-comment:${last.id}`, source: "jira", href }, now));
    }
  }
  return out;
}

/** Every loop the rules read now, the newest first. */
export function derivedLoops(opts: { now?: Date; days?: number; resolver?: Resolver } = {}): Loop[] {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - (opts.days ?? WINDOW_DAYS) * 864e5).toISOString();
  const r = opts.resolver ?? makeResolver();
  const me = whoAmI();
  const set = new Set([...me.names, ...me.handles]);
  return [...fromMail(r, since, now), ...fromTeams(r, since, now, set), ...fromJira(r, since, now, me)].sort((a, b) => b.at.localeCompare(a.at));
}

export type { LoopDirection };
