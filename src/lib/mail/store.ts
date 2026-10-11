import { createHash } from "node:crypto";
import { and, desc, gte, inArray, like, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getAppSettings, updateAppSettings } from "@/lib/ai";
import { isChatConv, type ChatFolder, type MailView } from "./shared";

export type { MailView } from "./shared";

const { emails } = schema;

/** A mail as the Outlook driver (src/plugins/outlook/driver.mjs, outlook_mail) reads it from the list. */
export type MailInput = {
  /** A message's own id (WhatsApp's, Signal's, Gmail's) — its key then, whatever it says. */
  id?: string;
  /** Its full text (not just the list's first line) — it replaces what's kept. */
  full?: boolean;
  convId: string;
  folder?: string;
  from: string;
  fromEmail: string | null;
  subject: string;
  preview: string;
  receivedAt: string | null;
  unread: boolean;
  /** A chat (WhatsApp, Signal): written in a group. */
  group?: boolean;
  /** A chat, in a group: it mentions you or quotes your message. */
  toMe?: boolean;
};

export type MailSettings = { syncMinutes: number; folders: string[]; lastSyncAt: string | null; lastResult: string | null; lastOk: boolean | null };

/** "Posteingang, Notifications" → the names, each once. */
const foldersOf = (text: string) => [...new Set(text.split(/[,;\n]/).map((f) => f.trim()).filter(Boolean))];

export function getMailSettings(): MailSettings {
  const s = getAppSettings();
  return { syncMinutes: s.mailSyncMinutes, folders: foldersOf(s.mailFolders || "Posteingang"), lastSyncAt: s.mailLastSyncAt, lastResult: s.mailLastResult, lastOk: s.mailLastOk };
}

export function updateMailSettings(patch: Partial<MailSettings>): void {
  updateAppSettings({
    ...(patch.syncMinutes !== undefined ? { mailSyncMinutes: Math.max(0, Math.min(1440, Math.round(patch.syncMinutes))) } : {}),
    ...(patch.folders !== undefined ? { mailFolders: patch.folders.join(", ") || "Posteingang" } : {}),
    ...(patch.lastSyncAt !== undefined ? { mailLastSyncAt: patch.lastSyncAt } : {}),
    ...(patch.lastResult !== undefined ? { mailLastResult: patch.lastResult } : {}),
    ...(patch.lastOk !== undefined ? { mailLastOk: patch.lastOk } : {}),
  });
}

/** A mail's key: its conversation, and what it says (a new mail in it — another preview — is another row). */
const keyOf = (m: MailInput) =>
  m.id ? `${m.convId}|${createHash("sha1").update(m.id).digest("hex").slice(0, 16)}` :
  `${m.convId}|${createHash("sha1").update(`${m.from}\n${m.subject}\n${m.preview}${isChatConv(m.convId) ? "" : `\n${m.receivedAt ?? ""}`}`).digest("hex").slice(0, 16)}`;

/** Keep the mails read — new ones added, known ones updated (read since?). How many were new, how many there are. */
export function saveMails(list: MailInput[]): { added: number; total: number } {
  const db = getDb();
  const now = new Date().toISOString();
  let added = 0;
  db.transaction((tx) => {
    for (const m of list) {
      if (!m.convId || !m.subject) continue;
      let key = keyOf(m);
      let known = tx.select({ key: emails.key }).from(emails).where(sql`${emails.key} = ${key}`).get();
      // A message kept before it had its id (the same conversation, time and first words): that
      // row it is — its key stays (todos cite it), its text may grow.
      if (!known && m.id && m.receivedAt) {
        const start = m.preview.replace(/\s+/g, " ").trim().slice(0, 40);
        const same = tx
          .select({ key: emails.key, preview: emails.preview })
          .from(emails)
          .where(and(sql`${emails.convId} = ${m.convId}`, sql`${emails.receivedAt} = ${m.receivedAt}`))
          .all()
          .find((r) => start && r.preview.replace(/\s+/g, " ").trim().slice(0, 40) === start);
        if (same) {
          known = same;
          key = same.key;
        }
      }
      if (known) {
        tx.update(emails)
          .set({ unread: m.unread, syncedAt: now, ...(m.full ? { preview: m.preview.slice(0, 1000) } : {}), ...(m.group !== undefined ? { isGroup: m.group, toMe: !!m.toMe } : {}) })
          .where(sql`${emails.key} = ${key}`)
          .run();
        continue;
      }
      tx.insert(emails)
        .values({
          key,
          convId: m.convId,
          folder: m.folder || "Posteingang",
          fromName: m.from || null,
          fromEmail: m.fromEmail,
          subject: m.subject.slice(0, 500),
          preview: m.preview.slice(0, 1000),
          receivedAt: m.receivedAt ?? now,
          unread: m.unread,
          syncedAt: now,
          isGroup: m.group ?? null,
          toMe: m.group === undefined ? null : !!m.toMe,
        })
        .run();
      added++;
    }
  });
  const total = db.select({ n: sql<number>`count(*)` }).from(emails).get()?.n ?? 0;
  return { added, total };
}

const toView = (r: typeof emails.$inferSelect): MailView => ({
  key: r.key,
  convId: r.convId,
  folder: r.folder,
  fromName: r.fromName,
  fromEmail: r.fromEmail,
  subject: r.subject,
  preview: r.preview,
  receivedAt: r.receivedAt,
  unread: r.unread,
  resolvedAt: r.resolvedAt,
});

/** How many mails each folder has. */
export function mailFolderCounts(): Record<string, number> {
  return Object.fromEntries(getDb().select({ folder: emails.folder, n: sql<number>`count(*)` }).from(emails).groupBy(emails.folder).all().map((r) => [r.folder, r.n]));
}

/** The mails with these keys, by key. */
export function mailsByKeys(keys: string[]): Map<string, MailView> {
  const wanted = [...new Set(keys.filter(Boolean))].slice(0, 100);
  if (!wanted.length) return new Map();
  return new Map(getDb().select().from(emails).where(inArray(emails.key, wanted)).all().map((r) => [r.key, toView(r)]));
}

/** The mails, newest first — those matching `q` (sender, subject, text). */
export function listMails(opts: { q?: string; folder?: string; exceptFolder?: string; folderPrefix?: string; limit?: number } = {}): MailView[] {
  const q = opts.q?.trim();
  const words = q ? or(like(emails.subject, `%${q}%`), like(emails.preview, `%${q}%`), like(emails.fromName, `%${q}%`), like(emails.fromEmail, `%${q}%`)) : undefined;
  const where = and(words, opts.folder ? sql`${emails.folder} = ${opts.folder}` : undefined, opts.exceptFolder ? sql`${emails.folder} <> ${opts.exceptFolder}` : undefined, opts.folderPrefix ? like(emails.folder, `${opts.folderPrefix}%`) : undefined);
  return getDb()
    .select()
    .from(emails)
    .where(where)
    .orderBy(desc(emails.receivedAt))
    // At most 2000 (the Mail page asks for 1500 — it got 500, silently).
    .limit(Math.min(2000, opts.limit ?? 200))
    .all()
    .map(toView);
}

/** A conversation's messages (a WhatsApp chat, a mail thread), oldest first — its last `limit`. */
export function conversationOf(convId: string, limit = 20): MailView[] {
  return getDb().select().from(emails).where(sql`${emails.convId} = ${convId}`).orderBy(desc(emails.receivedAt)).limit(limit).all().map(toView).reverse();
}

/** How far back a ticket's mails count as its context (as far as the sync reads: two months) — one window for Boards, the Ticket-Lage and the workers. */
export const MAIL_CONTEXT_DAYS = 60;

/** The mails of the last days that name a ticket (in subject or text), by ticket key. */
export function mailsForTickets(keys: string[], days = MAIL_CONTEXT_DAYS, perTicket = 8): Record<string, MailView[]> {
  if (!keys.length) return {};
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const rows = getDb()
    .select()
    .from(emails)
    .where(and(gte(emails.receivedAt, since), or(...keys.map((k) => or(like(emails.subject, `%${k}%`), like(emails.preview, `%${k}%`))))))
    .orderBy(desc(emails.receivedAt))
    .all()
    .map(toView);
  const out: Record<string, MailView[]> = {};
  for (const k of keys) {
    const re = new RegExp(`(^|[^A-Za-z0-9])${k}(?![0-9])`, "i");
    const list = rows.filter((m) => re.test(`${m.subject} ${m.preview}`));
    if (list.length) out[k] = list.slice(0, perTicket);
  }
  return out;
}

/** WhatsApp's own lines in a chat — not something a person wrote you. */
const WA_SYSTEM = /^\u202a?\s*(\+?[\d\s]+ wurde in \+?[\d\s]+ geändert|\+?[\d\s]+ changed (their phone number|to \+?[\d\s]+)|\d+ (ungelesene Nachricht(en)?|unread messages?)\b|.{0,80} hat (dich|die Gruppe|den Gruppennamen|das Gruppenbild)|.{0,80} (added you|created group|changed the group)|Nachrichten und Anrufe sind Ende-zu-Ende-verschlüsselt|Messages and calls are end-to-end encrypted|Deine Sicherheitsnummer|Your security code)/i;

/** A chat (WhatsApp, Signal) waiting for your answer: who, what since your last word, since when. */
export type ChatWaiting = { convId: string; key: string; who: string; text: string; count: number; since: string; lastAt: string; group: boolean };
export type WhatsappChatWaiting = ChatWaiting;

/**
 * A chat app's chats (WhatsApp, Signal) waiting for your answer — one per chat: the last word isn't
 * yours, and what came since yours (in the last `days`, not marked done). A group only with a message
 * to you (it mentions you or quotes yours) — not its announcements, pictures and chatter. WhatsApp's
 * own lines (a number changed, "5 ungelesene Nachrichten") and its own account don't count.
 */
export function chatsWaiting(folder: ChatFolder, days = 7, now = Date.now()): ChatWaiting[] {
  const since = new Date(now - days * 864e5).toISOString();
  const from = new Date(now - 60 * 864e5).toISOString();
  const rows = getDb()
    .select()
    .from(emails)
    .where(and(sql`${emails.folder} = ${folder}`, gte(emails.receivedAt, from)))
    .orderBy(emails.receivedAt)
    .all()
    .filter((m) => folder !== "WhatsApp" || !WA_SYSTEM.test(m.preview.trim()));
  const byConv = new Map<string, typeof rows>();
  for (const m of rows) {
    const list = byConv.get(m.convId);
    if (list) list.push(m);
    else byConv.set(m.convId, [m]);
  }
  const out: ChatWaiting[] = [];
  for (const [convId, all] of byConv) {
    const subject = all[all.length - 1].subject;
    const mine = (m: (typeof all)[number]) => m.fromName === "Ich";
    // The app's own account (WhatsApp's tips and offers) — not a conversation.
    if (subject === folder && !all.some(mine)) continue;
    const last = all[all.length - 1];
    if (mine(last)) continue;
    const lastMine = [...all].reverse().find(mine)?.receivedAt ?? "";
    // A group: as the sync says — else (read before it said so) someone writing in it under another name than the chat's.
    const group = all.some((m) => m.isGroup) || (all.every((m) => m.isGroup === null) && all.some((m) => !mine(m) && m.fromName !== subject));
    const after = all.filter((m) => !mine(m) && m.receivedAt > lastMine && !m.resolvedAt && (!group || m.toMe));
    const newest = after[after.length - 1];
    if (!newest || newest.receivedAt < since) continue;
    out.push({
      convId,
      key: newest.key,
      who: subject,
      text: group || (newest.fromName && newest.fromName !== subject) ? `${newest.fromName}: ${newest.preview}` : newest.preview,
      count: after.length,
      since: after[0].receivedAt,
      lastAt: newest.receivedAt,
      group,
    });
  }
  return out.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

/** The WhatsApp chats waiting for your answer (see chatsWaiting). */
export const whatsappChatsWaiting = (days = 7, now = Date.now()) => chatsWaiting("WhatsApp", days, now);
