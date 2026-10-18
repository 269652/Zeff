import { and, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";

/**
 * A mailbox folder that follows the mailbox like an IMAP mirror (Gmail through its API: the inbox, and the labels you chose): what
 * leaves it there — archived, moved under another label — leaves it here, however old it is. The mail itself stays (todos and the
 * knowledge base cite it): it goes to the folder's archive, "<folder> · Archive", which the Workspace's mail databases leave out
 * unless asked. Server only.
 */

export const ARCHIVE_SUFFIX = " · Archive";
export const archiveOf = (folder: string): string => `${folder.split("/")[0]}${ARCHIVE_SUFFIX}`;
export const isArchiveFolder = (folder: string): boolean => folder.endsWith(ARCHIVE_SUFFIX);

/** What you sent is a folder of its own, like IMAP's Sent — not the inbox's. */
export const SENT_SUFFIX = " · Sent";
export const sentOf = (folder: string): string => `${folder.split("/")[0]}${SENT_SUFFIX}`;
export const isSentFolder = (folder: string): boolean => folder.endsWith(SENT_SUFFIX);
/** Folders the Workspace's mail databases leave out unless asked for (what left the inbox, what you sent). */
export const isSideFolder = (folder: string): boolean => isArchiveFolder(folder) || isSentFolder(folder);

/** Your own mails kept in the folder (before the sent folder was there) go to it. How many. */
export function moveSent(folder: string, me = "Ich"): number {
  const r = getDb()
    .update(schema.emails)
    .set({ folder: sentOf(folder) })
    .where(and(sql`${schema.emails.folder} = ${folder}`, sql`${schema.emails.convId} like 'gmail:%'`, sql`coalesce(${schema.emails.fromName}, '') = ${me}`))
    .run();
  return r.changes;
}

/** What the mailbox holds in a folder now: the keys of its mails here, their conversations, and whether the list was read to its end. */
export type MirrorRead = { folder: string; complete: boolean; keys: string[]; convIds: string[] };

/**
 * After a read of a mirrored folder: the mails kept in it that the mailbox no longer holds there go to the archive. A mail kept in
 * the days before ids (its key is not the id's) stays as long as its conversation is in the folder; your own mails ("Ich") never
 * move; a list cut off before its end says nothing at all. How many were moved.
 */
export function archiveGone(o: { read: MirrorRead; me?: string }): number {
  const { folder, complete, keys, convIds } = o.read;
  if (!complete) return 0;
  const have = new Set(keys);
  const threads = new Set(convIds);
  const db = getDb();
  const rows = db
    .select({ key: schema.emails.key, convId: schema.emails.convId })
    .from(schema.emails)
    .where(and(sql`${schema.emails.folder} = ${folder}`, sql`${schema.emails.convId} like 'gmail:%'`, sql`coalesce(${schema.emails.fromName}, '') <> ${o.me ?? "Ich"}`))
    .all();
  const gone = rows.filter((r) => !have.has(r.key) && !threads.has(r.convId));
  // And what the mailbox holds here again (put back in the inbox, or under the label) comes back out of the archive, whatever its age.
  const back = db
    .select({ key: schema.emails.key })
    .from(schema.emails)
    .where(and(sql`${schema.emails.folder} = ${archiveOf(folder)}`, sql`${schema.emails.convId} like 'gmail:%'`))
    .all()
    .filter((r) => have.has(r.key));
  if (!gone.length && !back.length) return 0;
  db.transaction((tx) => {
    for (const r of gone) tx.update(schema.emails).set({ folder: archiveOf(folder) }).where(sql`${schema.emails.key} = ${r.key}`).run();
    for (const r of back) tx.update(schema.emails).set({ folder }).where(sql`${schema.emails.key} = ${r.key}`).run();
  });
  return gone.length;
}
