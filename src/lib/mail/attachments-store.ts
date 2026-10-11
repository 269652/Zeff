/**
 * Mail attachments → Documents: the settings (per account, in prefs) and the bookkeeping table
 * `mail_attachments` — which attachment of which mail was seen, what became of it. Server only.
 */
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getPref, setPref } from "@/lib/prefs";
import { isInstalled } from "@/plugins/state";
import type { DocOrigin } from "./shared";
import { decideAttachment, folderAllowed, inWindow, mailSourceOf, parseAttachmentSettings, senderAllowed, type AttachmentSettings, type AttachmentSource } from "./attachment-rules";

const { emails, mailAttachments } = schema;

const SETTINGS_KEY = "mail:attachments";
const OFFER_KEY = "mail:attachments:offer";

/** A failed attachment (or mail) is tried again this many times in all, then left. */
export const MAX_TRIES = 3;

export const attachmentSettings = (): AttachmentSettings => parseAttachmentSettings(getPref(SETTINGS_KEY, {}));

/** Keep the settings (a patch over what's there; anything out of bounds is brought back in). */
export function saveAttachmentSettings(patch: Partial<AttachmentSettings>): AttachmentSettings {
  const next = parseAttachmentSettings({ ...attachmentSettings(), ...patch });
  setPref(SETTINGS_KEY, next);
  return next;
}

/** Whether the one-time notice is shown: Documents and a mail source are installed, it is off, and it was never answered. */
export const attachmentOfferOpen = (): boolean => isInstalled("documents") && (isInstalled("outlook-mail") || isInstalled("gmail")) && attachmentOfferAnswer() === null && !attachmentSettings().enabled;

/** The one-time notice: null until answered; "on" (turned on from it) or "later" (declined — it stays in the settings). */
export const attachmentOfferAnswer = (): "on" | "later" | null => {
  const v = getPref<string | null>(OFFER_KEY, null);
  return v === "on" || v === "later" ? v : null;
};
export const answerAttachmentOffer = (answer: "on" | "later") => setPref(OFFER_KEY, answer);

export type AttachmentRow = typeof mailAttachments.$inferSelect;

export const attachmentRows = (source: AttachmentSource, mailKey: string): AttachmentRow[] =>
  getDb().select().from(mailAttachments).where(and(eq(mailAttachments.source, source), eq(mailAttachments.mailKey, mailKey))).orderBy(asc(mailAttachments.id)).all();

type RowInput = { source: AttachmentSource; mailKey: string; attKey: string; name?: string; mime?: string; size?: number; docId?: number | null; status: "done" | "skipped" | "failed" | "none"; error?: string };

/** Note what became of an attachment (a failure counts a try; anything else resets them). */
export function noteAttachment(r: RowInput): void {
  const now = new Date().toISOString();
  const db = getDb();
  const had = db
    .select({ id: mailAttachments.id, tries: mailAttachments.tries })
    .from(mailAttachments)
    .where(and(eq(mailAttachments.source, r.source), eq(mailAttachments.mailKey, r.mailKey), eq(mailAttachments.attKey, r.attKey)))
    .get();
  const values = {
    name: (r.name ?? "").slice(0, 300),
    mime: (r.mime ?? "").slice(0, 100),
    size: r.size ?? 0,
    docId: r.docId ?? null,
    status: r.status,
    error: (r.error ?? "").slice(0, 300),
    tries: r.status === "failed" ? (had?.tries ?? 0) + 1 : 0,
    fetchedAt: now,
  };
  if (had) db.update(mailAttachments).set(values).where(eq(mailAttachments.id, had.id)).run();
  else db.insert(mailAttachments).values({ source: r.source, mailKey: r.mailKey, attKey: r.attKey, ...values }).run();
}

/** A mail the list flagged: what the sync step needs to fetch its attachments. */
export type MailCandidate = {
  key: string;
  source: AttachmentSource;
  /** Gmail: the account (as set in the Gmail plugin) whose mailbox it is in. */
  account?: string;
  ref: string;
  folder: string;
  subject: string;
  fromName: string | null;
  fromEmail: string | null;
  receivedAt: string;
  unread: boolean;
};

/** Whether anything is left to do for a mail, given what's been noted: nothing seen yet, a retry due, or a skipped one the rules take now. */
export function mailNeedsWork(rows: AttachmentRow[], s: AttachmentSettings): boolean {
  if (!rows.length) return true;
  return rows.some((r) => (r.status === "failed" && r.tries < MAX_TRIES) || (r.status === "skipped" && !!r.attKey && decideAttachment({ name: r.name, mime: r.mime, size: r.size }, s).take));
}

/**
 * The mails of the last `days` days that the list flagged with attachments, newest first, for the
 * sources that are on — folder and sender lists applied, and only those with something left to do.
 * `gmailFolders` maps a Gmail folder name to its account (a folder of an account no longer set up is left out).
 */
export function attachmentCandidates(s: AttachmentSettings, on: AttachmentSource[], gmailFolders: Map<string, string>, now = Date.now()): MailCandidate[] {
  const since = new Date(now - s.days * 864e5).toISOString();
  const rows = getDb().select().from(emails).where(and(sql`${emails.hasAttachments} = 1`, gte(emails.receivedAt, since))).orderBy(desc(emails.receivedAt)).all();
  const out: MailCandidate[] = [];
  for (const m of rows) {
    const source = mailSourceOf(m.convId);
    if (!source || !on.includes(source) || !m.attachRef || !inWindow(m.receivedAt, s.days, now)) continue;
    if (!folderAllowed(m.folder, s) || !senderAllowed(m.fromEmail, s)) continue;
    // Gmail: only a message of the mailbox itself (msg-f:…; msg-a: are drafts and sent mail).
    if (source === "gmail" && !/^msg-f:\d+$/.test(m.attachRef)) continue;
    const account = source === "gmail" ? gmailFolders.get(m.folder) : undefined;
    if (source === "gmail" && account === undefined) continue;
    if (!mailNeedsWork(attachmentRows(source, m.key), s)) continue;
    out.push({ key: m.key, source, account, ref: m.attachRef, folder: m.folder, subject: m.subject, fromName: m.fromName, fromEmail: m.fromEmail, receivedAt: m.receivedAt, unread: m.unread });
  }
  return out;
}

/** How many flagged mails in the window we don't know about yet (read before the list could say), for the “read them again” hint. */
export function unknownAttachmentMails(days: number, now = Date.now()): number {
  const since = new Date(now - days * 864e5).toISOString();
  return getDb().select({ n: sql<number>`count(*)` }).from(emails).where(and(sql`${emails.hasAttachments} is null`, gte(emails.receivedAt, since), sql`${emails.folder} not in ('WhatsApp', 'Signal')`)).get()?.n ?? 0;
}

/** Where documents came from — the mail an attachment was taken from (the first one, when several mails had it). */
export function documentOrigins(docIds: number[]): Record<number, DocOrigin> {
  const ids = [...new Set(docIds)];
  if (!ids.length) return {};
  const rows = getDb()
    .select({ docId: mailAttachments.docId, source: mailAttachments.source, mailKey: mailAttachments.mailKey, file: mailAttachments.name, subject: emails.subject, fromName: emails.fromName, fromEmail: emails.fromEmail, receivedAt: emails.receivedAt })
    .from(mailAttachments)
    .innerJoin(emails, eq(emails.key, mailAttachments.mailKey))
    .where(and(inArray(mailAttachments.docId, ids), eq(mailAttachments.status, "done")))
    .orderBy(asc(mailAttachments.id))
    .all();
  const out: Record<number, DocOrigin> = {};
  for (const r of rows) {
    if (r.docId === null || out[r.docId]) continue;
    out[r.docId] = { mailKey: r.mailKey, source: r.source as AttachmentSource, subject: r.subject, from: r.fromName || r.fromEmail || "", receivedAt: r.receivedAt, file: r.file };
  }
  return out;
}

/** Counts for the settings section: documents taken so far, and attachments that failed for good. */
export function attachmentTotals(): { documents: number; failed: number } {
  const db = getDb();
  const documents = db.select({ n: sql<number>`count(distinct ${mailAttachments.docId})` }).from(mailAttachments).where(eq(mailAttachments.status, "done")).get()?.n ?? 0;
  const failed = db.select({ n: sql<number>`count(*)` }).from(mailAttachments).where(and(eq(mailAttachments.status, "failed"), sql`${mailAttachments.tries} >= ${MAX_TRIES}`)).get()?.n ?? 0;
  return { documents, failed };
}
