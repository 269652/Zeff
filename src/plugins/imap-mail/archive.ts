import { and, eq, inArray, like } from "drizzle-orm";
import { getDb, getSqlite, schema } from "@/db";
import { ARCHIVE_SUFFIX } from "@/lib/mail/mirror";
import { ME_SENDER } from "@/lib/mail/shared";
import { archivePage } from "@/plugins/workspace/store";
import { archiveImap, type MailDeps } from "./client";
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
    getDb().update(schema.emails).set({ folder: `${mailboxName(a)}${ARCHIVE_SUFFIX}` }).where(inArray(schema.emails.key, list.map((m) => m.key))).run();
    for (const row of rowsShowing(list.map((m) => m.key))) archivePage(row);
    archived += list.length;
  }
  return { archived, failed };
}

/** Every read mail in the inbox of the IMAP / POP3 accounts (one, or all) archived — yours, sent, are not in the inbox anyway. */
export async function archiveReadInbox(accountId?: string, deps: MailDeps = {}): Promise<{ archived: number; failed: string[] }> {
  const accounts = mailAccounts().filter((a) => !accountId || a.id === accountId);
  const keys: string[] = [];
  for (const a of accounts) {
    const read = getDb()
      .select({ key: schema.emails.key, convId: schema.emails.convId, unread: schema.emails.unread, fromName: schema.emails.fromName })
      .from(schema.emails)
      .where(and(like(schema.emails.convId, `imap:${a.id}:%`), eq(schema.emails.folder, mailboxName(a))))
      .all();
    // A conversation with something unread stays whole.
    const unreadConvs = new Set(read.filter((m) => m.unread).map((m) => m.convId));
    keys.push(...read.filter((m) => !m.unread && m.fromName !== ME_SENDER && !unreadConvs.has(m.convId)).map((m) => m.key));
  }
  return archiveMails(keys, deps);
}

/** The mails the rows of a database show ("mail:<key>"). */
export function mailKeysOfRows(rowIds: number[]): string[] {
  if (!rowIds.length) return [];
  return (getSqlite().prepare(`select json_extract(props, '$.srcref') as ref from ws_pages where id in (${rowIds.map(() => "?").join(",")})`).all(...rowIds) as { ref: string | null }[]).flatMap((r) => (r.ref?.startsWith("mail:") ? [r.ref.slice(5)] : []));
}
