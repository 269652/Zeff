import { and, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { TeamsSettings } from "@/db/schema";
import { teamsLinkKey, type TeamsKind, type TeamsMessageView } from "./shared";

const { teamsMessages, teamsSettings, contexts } = schema;

/** A message as the Teams driver (src/plugins/teams/driver.mjs) reads it. */
export type TeamsMessageInput = {
  key: string;
  kind: TeamsKind;
  mentionType: string | null;
  conversationId: string;
  replyChainId: string | null;
  messageId: string;
  place: string | null;
  senderName: string | null;
  senderId: string | null;
  /** Milliseconds since the epoch. */
  sentAt: number;
  subject: string | null;
  html: string;
  text: string;
  link: string;
  isRead: boolean | null;
};

export function getTeamsSettings(): TeamsSettings {
  const db = getDb();
  return db.select().from(teamsSettings).limit(1).get() ?? db.insert(teamsSettings).values({ id: 1 }).returning().get();
}

export function updateTeamsSettings(patch: Partial<Omit<TeamsSettings, "id">>): TeamsSettings {
  getTeamsSettings(); // ensure the row exists
  return getDb().update(teamsSettings).set(patch).returning().get();
}

/** Keep what was read (each message replacing its last copy). Returns how many are new and how many there are in all. */
export function saveTeamsMessages(list: TeamsMessageInput[]): { added: number; total: number } {
  const db = getDb();
  const syncedAt = new Date().toISOString();
  const keys = list.map((m) => m.key);
  const known = new Set<string>();
  for (let i = 0; i < keys.length; i += 500) {
    for (const r of db.select({ key: teamsMessages.key }).from(teamsMessages).where(inArray(teamsMessages.key, keys.slice(i, i + 500))).all()) known.add(r.key);
  }
  db.transaction((tx) => {
    for (const m of list) {
      if (!m?.key || !m.conversationId || !m.messageId || !Number.isFinite(m.sentAt)) continue;
      const row = {
        kind: m.kind === "pm" || m.kind === "chat" ? m.kind : "mention",
        mentionType: m.mentionType ?? null,
        conversationId: m.conversationId,
        replyChainId: m.replyChainId ?? null,
        messageId: m.messageId,
        place: m.place ?? null,
        senderName: m.senderName ?? null,
        senderId: m.senderId ?? null,
        sentAt: new Date(m.sentAt).toISOString(),
        subject: m.subject ?? null,
        html: String(m.html ?? ""),
        text: String(m.text ?? ""),
        link: String(m.link ?? ""),
        isRead: m.isRead ?? null,
        syncedAt,
      };
      tx.insert(teamsMessages).values({ key: m.key, ...row }).onConflictDoUpdate({ target: teamsMessages.key, set: row }).run();
    }
  });
  const total = db.select({ n: sql<number>`count(*)` }).from(teamsMessages).get()?.n ?? 0;
  return { added: keys.filter((k) => !known.has(k)).length, total: Number(total) };
}

/**
 * Messages, newest first: of one kind, matching words (sender, place, subject or text) — or
 * the one a pasted message link points at — and whether each is already context.
 */
export function listTeamsMessages(opts: { q?: string; kind?: TeamsKind; limit?: number } = {}): TeamsMessageView[] {
  const conditions = [];
  // A chat's other messages (yours, group chats) only when asked for: the lists are what came to you.
  conditions.push(opts.kind ? eq(teamsMessages.kind, opts.kind) : sql`${teamsMessages.kind} <> 'chat'`);
  const link = teamsLinkKey(opts.q);
  if (link) conditions.push(eq(teamsMessages.key, link));
  const words = link ? [] : (opts.q ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 6);
  for (const word of words) {
    const p = `%${word.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    conditions.push(
      or(
        sql`${teamsMessages.text} like ${p} escape '\\'`,
        sql`${teamsMessages.senderName} like ${p} escape '\\'`,
        sql`${teamsMessages.place} like ${p} escape '\\'`,
        sql`${teamsMessages.subject} like ${p} escape '\\'`,
      )!,
    );
  }
  const rows = getDb()
    .select()
    .from(teamsMessages)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(teamsMessages.sentAt))
    .limit(Math.min(500, opts.limit ?? 100))
    .all();
  // Already context: an item links to the message (its "Open in Teams" link names conversation and message).
  const used = new Set<string>();
  if (rows.length) {
    const linked = getDb().select({ links: contexts.links }).from(contexts).where(like(contexts.links, "%teams.microsoft.com/l/message/%")).all();
    const all = linked.map((r) => r.links).join("\n");
    for (const r of rows) if (all.includes(`/l/message/${r.conversationId}/${r.messageId}`)) used.add(r.key);
  }
  return rows.map((r) => toView(r, used.has(r.key)));
}

function toView(r: typeof teamsMessages.$inferSelect, inContext = false): TeamsMessageView {
  return {
    key: r.key,
    kind: r.kind === "pm" || r.kind === "chat" ? r.kind : "mention",
    mentionType: r.mentionType,
    place: r.place,
    senderName: r.senderName,
    sentAt: r.sentAt,
    subject: r.subject,
    html: r.html,
    text: r.text,
    link: r.link,
    isRead: r.isRead,
    inContext,
    resolvedAt: r.resolvedAt,
  };
}

/** The synced messages with these keys ("<conversationId>|<messageId>"), by key. */
export function teamsMessagesByKeys(keys: string[]): Map<string, TeamsMessageView> {
  const wanted = [...new Set(keys.filter(Boolean))].slice(0, 50);
  if (!wanted.length) return new Map();
  const rows = getDb().select().from(teamsMessages).where(inArray(teamsMessages.key, wanted)).all();
  return new Map(rows.map((r) => [r.key, toView(r)]));
}

/** How many messages there are, by kind. */
export function teamsMessageCounts(): { all: number; mention: number; pm: number } {
  const rows = getDb().select({ kind: teamsMessages.kind, n: sql<number>`count(*)` }).from(teamsMessages).groupBy(teamsMessages.kind).all();
  const by = Object.fromEntries(rows.map((r) => [r.kind, Number(r.n)]));
  return { all: (by.mention ?? 0) + (by.pm ?? 0), mention: by.mention ?? 0, pm: by.pm ?? 0 };
}

/** A 1:1 chat waiting for your answer: who, their messages since your last word, since when. */
export type TeamsChatWaiting = {
  conversationId: string;
  /** The other side (their names). */
  who: string;
  /** Their newest message. */
  text: string;
  key: string;
  link: string;
  /** Their messages since your last word. */
  count: number;
  /** ISO: the first of them — waiting since. */
  since: string;
  /** ISO: the newest. */
  lastAt: string;
};

/**
 * The 1:1 chats waiting for your answer — one per conversation (not one per message): the last word
 * isn't yours, and what they wrote since yours (in the last `days`) isn't marked done or a context
 * item already. Your messages are the chat's ones not from the other side (pm: theirs only).
 */
export function teamsChatsWaiting(days = 3, now = Date.now()): TeamsChatWaiting[] {
  const db = getDb();
  const since = new Date(now - days * 864e5).toISOString();
  const recent = db
    .select({ conversationId: teamsMessages.conversationId })
    .from(teamsMessages)
    .where(and(eq(teamsMessages.kind, "pm"), sql`${teamsMessages.sentAt} >= ${since}`))
    .groupBy(teamsMessages.conversationId)
    .all()
    .map((r) => r.conversationId);
  if (!recent.length) return [];
  const linked = db.select({ links: contexts.links }).from(contexts).where(like(contexts.links, "%teams.microsoft.com/l/message/%")).all().map((r) => r.links).join("\n");
  // Those conversations' last month in one query, only what's needed (not the html).
  const from = new Date(now - 30 * 864e5).toISOString();
  const rows = db
    .select({
      key: teamsMessages.key,
      kind: teamsMessages.kind,
      conversationId: teamsMessages.conversationId,
      messageId: teamsMessages.messageId,
      senderId: teamsMessages.senderId,
      senderName: teamsMessages.senderName,
      place: teamsMessages.place,
      sentAt: teamsMessages.sentAt,
      text: teamsMessages.text,
      link: teamsMessages.link,
      resolvedAt: teamsMessages.resolvedAt,
    })
    .from(teamsMessages)
    .where(and(inArray(teamsMessages.conversationId, recent), sql`${teamsMessages.sentAt} >= ${from}`))
    .orderBy(teamsMessages.sentAt)
    .all();
  const byConv = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byConv.get(r.conversationId);
    if (list) list.push(r);
    else byConv.set(r.conversationId, [r]);
  }
  const out: TeamsChatWaiting[] = [];
  for (const [conv, all] of byConv) {
    const theirs = new Set(all.filter((m) => m.kind === "pm" && m.senderId).map((m) => m.senderId!));
    const mine = (m: (typeof all)[number]) => m.kind !== "pm" && !!m.senderId && !theirs.has(m.senderId);
    const last = all[all.length - 1];
    if (!last || mine(last)) continue;
    const lastMine = [...all].reverse().find(mine)?.sentAt ?? "";
    const waiting = all.filter(
      (m) => m.kind === "pm" && m.sentAt > lastMine && m.sentAt >= since && !m.resolvedAt && !linked.includes(`/l/message/${m.conversationId}/${m.messageId}`),
    );
    if (!waiting.length) continue;
    const newest = waiting[waiting.length - 1];
    const names = [...new Set(waiting.map((m) => m.senderName).filter((n): n is string => !!n))];
    out.push({
      conversationId: conv,
      who: names.join(", ") || newest.place?.replace(/^Chat with /, "") || "Teams",
      text: newest.text,
      key: newest.key,
      link: newest.link,
      count: waiting.length,
      since: waiting[0].sentAt,
      lastAt: newest.sentAt,
    });
  }
  return out.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}
