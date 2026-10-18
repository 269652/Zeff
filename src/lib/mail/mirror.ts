import { and, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { keyOf, type MailInput } from "./store";

/**
 * A mailbox folder that follows the mailbox like an IMAP mirror (Gmail through its API: the inbox, and the labels you chose): what
 * leaves it there — archived, moved under another label — leaves it here. The mail itself stays (todos and the knowledge base
 * cite it): it goes to the folder's archive, "<folder> · Archive", which the Workspace's mail databases leave out unless asked.
 * Server only.
 */

export const ARCHIVE_SUFFIX = " · Archive";
export const archiveOf = (folder: string): string => `${folder.split("/")[0]}${ARCHIVE_SUFFIX}`;
export const isArchiveFolder = (folder: string): boolean => folder.endsWith(ARCHIVE_SUFFIX);

export type MirrorRead = { folder: string; complete: boolean; oldest: string | null };

/**
 * After a read of a mirrored folder: the mails kept in it, received within the days read, that were not among the mails read go to
 * the archive. A read that was cut off (more pages than were read) says nothing about mails older than the oldest it got. Your own
 * mails ("Ich") are never moved. How many were moved.
 */
export function archiveGone(o: { read: MirrorRead; seen: MailInput[]; sinceIso: string; me?: string }): number {
  const { folder, complete, oldest } = o.read;
  const cutoff = complete || !oldest ? o.sinceIso : oldest > o.sinceIso ? oldest : o.sinceIso;
  const keys = new Set(o.seen.map(keyOf));
  const pairs = new Set(o.seen.map((m) => `${m.convId}|${m.receivedAt}`));
  const db = getDb();
  const rows = db
    .select({ key: schema.emails.key, convId: schema.emails.convId, receivedAt: schema.emails.receivedAt })
    .from(schema.emails)
    .where(and(sql`${schema.emails.folder} = ${folder}`, sql`${schema.emails.convId} like 'gmail:%'`, sql`coalesce(${schema.emails.fromName}, '') <> ${o.me ?? "Ich"}`, sql`${schema.emails.receivedAt} >= ${cutoff}`))
    .all();
  const gone = rows.filter((r) => !keys.has(r.key) && !pairs.has(`${r.convId}|${r.receivedAt}`));
  if (!gone.length) return 0;
  db.transaction((tx) => {
    for (const r of gone) tx.update(schema.emails).set({ folder: archiveOf(folder) }).where(sql`${schema.emails.key} = ${r.key}`).run();
  });
  return gone.length;
}
