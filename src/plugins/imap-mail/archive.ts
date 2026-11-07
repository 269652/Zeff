import { and, eq, inArray, like } from "drizzle-orm";
import { getDb, getSqlite, schema } from "@/db";
import { ARCHIVE_SUFFIX } from "@/lib/mail/mirror";
import { ME_SENDER } from "@/lib/mail/shared";
import { archivePage } from "@/plugins/workspace/store";
import { archiveImap, archiveSeenImap, type MailDeps } from "./client";
import { accountIdOfConv, getMailAccount, mailAccounts, mailboxName, saveMailAccount } from "./config";
import { serverFolderOf } from "./read-on-open";

/**
 * Mails of IMAP / POP3 accounts archived: out of the inbox — on the server moved to the account's archive (Gmail: All Mail), in Zeff
 * to "<name> · Archive", which the mail databases leave out; the rows showing them go. A whole conversation goes at once. POP3 has no
 * folders on the server: archived in Zeff only. Server only.
 */

type Mail = typeof schema.emails.$inferSelect;

/** The rows of the mail and inbox databases that show these mails ("mail:<key>"). */
function rowsShowing(keys: string[]): number[] {
  if (!keys.length) return [];
  const refs = keys.map((k) => `mail:${k}`);
  return (getSqlite().prepare(`select id from ws_pages where archived_at is null and json_extract(props, '$.srcref') in (${refs.map(() => "?").join(",")})`).all(...refs) as { id: number }[]).map((r) => r.id);
}

/** These mails' conversations as they stand in their inbox (one mail of a thread archives the thread). */
function inboxMailsOf(mails: Mail[]): Mail[] {
  const convs = [...new Set(mails.map((m) => m.convId))];
  if (!convs.length) return [];
  const all = getDb().select().from(schema.emails).where(inArray(schema.emails.convId, convs)).all();
  return all.filter((m) => {
    const a = getMailAccount(accountIdOfConv(m.convId) ?? "");
    return !!a && m.folder === mailboxName(a);
  });
}

export async function archiveMails(keys: string[], deps: MailDeps = {}): Promise<{ archived: number; failed: string[] }> {
  if (!keys.length) return { archived: 0, failed: [] };
  const picked = getDb().select().from(schema.emails).where(inArray(schema.emails.key, keys)).all().filter((m) => !!accountIdOfConv(m.convId));
  const mails = inboxMailsOf(picked);
  const failed: string[] = [];
  let archived = 0;
  const byAccount = new Map<string, Mail[]>();
  for (const m of mails) byAccount.set(accountIdOfConv(m.convId)!, [...(byAccount.get(accountIdOfConv(m.convId)!) ?? []), m]);
  for (const [id, list] of byAccount) {
    const a = getMailAccount(id);
    if (!a) continue;
    if (a.method === "imap") {
      try {
        const items = list.flatMap((m) => (m.attachRef ? [{ path: serverFolderOf(a, m.folder) ?? "INBOX", messageId: m.attachRef }] : []));
        const r = await archiveImap(a, items, deps);
        if (r.folder && r.folder !== a.archiveFolder) saveMailAccount(a.id, { archiveFolder: r.folder });
      } catch (e) {
        failed.push(`${mailboxName(a)}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
    }
    // In Zeff: to the account's archive, and out of the databases' views.
    archiveLocally(a, list.map((m) => m.key));
    archived += list.length;
  }
  return { archived, failed };
}

/**
 * Every read mail in the inbox of the IMAP / POP3 accounts (one, or all) archived. IMAP: on the server, all of the inbox's read mails —
 * also the older ones Zeff never read in (it keeps the last weeks); then in Zeff the read ones it knows. POP3: in Zeff only, a
 * conversation with something unread staying whole. `archived`: how many left the inbox (on the server, where there is one).
 */
export async function archiveReadInbox(accountId?: string, deps: MailDeps = {}): Promise<{ archived: number; failed: string[] }> {
  const accounts = mailAccounts().filter((a) => !accountId || a.id === accountId);
  const failed: string[] = [];
  let archived = 0;
  for (const a of accounts) {
    const read = getDb()
      .select({ key: schema.emails.key, convId: schema.emails.convId, unread: schema.emails.unread, fromName: schema.emails.fromName })
      .from(schema.emails)
      .where(and(like(schema.emails.convId, `imap:${a.id}:%`), eq(schema.emails.folder, mailboxName(a))))
      .all();
    if (a.method === "imap") {
      let moved = 0;
      try {
        const r = await archiveSeenImap(a, serverFolderOf(a, mailboxName(a)) ?? "INBOX", deps);
        if (r.folder && r.folder !== a.archiveFolder) saveMailAccount(a.id, { archiveFolder: r.folder });
        moved = r.moved;
      } catch (e) {
        failed.push(`${mailboxName(a)}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      // In Zeff: the read ones it knows follow (on the server they are gone already).
      const keys = read.filter((m) => !m.unread).map((m) => m.key);
      archiveLocally(a, keys);
      archived += Math.max(moved, keys.length);
      continue;
    }
    // A conversation with something unread stays whole.
    const unreadConvs = new Set(read.filter((m) => m.unread).map((m) => m.convId));
    const r = await archiveMails(read.filter((m) => !m.unread && m.fromName !== ME_SENDER && !unreadConvs.has(m.convId)).map((m) => m.key), deps);
    archived += r.archived;
    failed.push(...r.failed);
  }
  return { archived, failed };
}

/** Mails of an account archived in Zeff: to its archive folder, and out of the databases' views. */
function archiveLocally(a: { name: string } & Parameters<typeof mailboxName>[0], keys: string[]): void {
  if (!keys.length) return;
  getDb().update(schema.emails).set({ folder: `${mailboxName(a)}${ARCHIVE_SUFFIX}` }).where(inArray(schema.emails.key, keys)).run();
  for (const row of rowsShowing(keys)) archivePage(row);
}

/** The mails the rows of a database show ("mail:<key>"). */
export function mailKeysOfRows(rowIds: number[]): string[] {
  if (!rowIds.length) return [];
  return (getSqlite().prepare(`select json_extract(props, '$.srcref') as ref from ws_pages where id in (${rowIds.map(() => "?").join(",")})`).all(...rowIds) as { ref: string | null }[]).flatMap((r) => (r.ref?.startsWith("mail:") ? [r.ref.slice(5)] : []));
}
