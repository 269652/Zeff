import { createHash } from "node:crypto";
import { and, desc, gte, inArray, like, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getAppSettings, updateAppSettings } from "@/lib/ai";
import type { MailView } from "./shared";

export type { MailView } from "./shared";

const { emails } = schema;

/** A mail as the Outlook driver (scripts/outlook-mcp.mjs, outlook_mail) reads it from the list. */
export type MailInput = {
  /** A message's own id (WhatsApp's) — its key then, whatever it says. */
  id?: string;
  convId: string;
  folder?: string;
  from: string;
  fromEmail: string | null;
  subject: string;
  preview: string;
  receivedAt: string | null;
  unread: boolean;
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
  `${m.convId}|${createHash("sha1").update(`${m.from}\n${m.subject}\n${m.preview}${m.convId.startsWith("wa:") ? "" : `\n${m.receivedAt ?? ""}`}`).digest("hex").slice(0, 16)}`;

/** Keep the mails read — new ones added, known ones updated (read since?). How many were new, how many there are. */
export function saveMails(list: MailInput[]): { added: number; total: number } {
  const db = getDb();
  const now = new Date().toISOString();
  let added = 0;
  db.transaction((tx) => {
    for (const m of list) {
      if (!m.convId || !m.subject) continue;
      const key = keyOf(m);
      const known = tx.select({ key: emails.key }).from(emails).where(sql`${emails.key} = ${key}`).get();
      if (known) {
        tx.update(emails).set({ unread: m.unread, syncedAt: now }).where(sql`${emails.key} = ${key}`).run();
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
    .limit(Math.min(500, opts.limit ?? 200))
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
