import { inArray } from "drizzle-orm";
import { getDb, getSqlite, schema } from "@/db";
import { getPage, setCell } from "@/plugins/workspace/store";
import { markSeenImap, type MailDeps } from "./client";
import { accountIdOfConv, getMailAccount, mailboxName, saveMailAccount, type MailAccount } from "./config";

/**
 * A mail opened in Zeff is read: rows of a mail or inbox database picked and looked at — their IMAP / POP3 mails (an account with
 * "mark read when opened", the default) are read in Zeff at once, and on the server (the \Seen flag) in the background. POP3 has no
 * flags: read in Zeff only. Other channels are left as they are. Server only.
 */

const UNREAD = ["communread", "mailunread"];

/** The server folder a mail's folder name stands for: the account's name is its inbox, "<name> · Sent" its Sent folder, "<name> · X" X. */
export function serverFolderOf(a: Pick<MailAccount, "name" | "sentFolder" | "archiveFolder">, folder: string): string | null {
  const name = mailboxName(a);
  if (folder === name) return "INBOX";
  if (!folder.startsWith(`${name} · `)) return null;
  const rest = folder.slice(name.length + 3);
  return rest === "Sent" ? a.sentFolder || null : rest === "Archive" ? a.archiveFolder || null : rest;
}

export async function markOpenedRead(rowIds: number[], deps: MailDeps = {}): Promise<{ marked: number }> {
  // The rows' mails ("mail:<key>"), those still unread and of an account that wants it.
  const keyOf = new Map<string, number>();
  for (const id of rowIds) {
    const ref = String(getPage(id)?.props?.srcref ?? "");
    if (ref.startsWith("mail:")) keyOf.set(ref.slice(5), id);
  }
  if (!keyOf.size) return { marked: 0 };
  const mails = getDb().select().from(schema.emails).where(inArray(schema.emails.key, [...keyOf.keys()])).all();
  const due = mails.filter((m) => {
    const acc = accountIdOfConv(m.convId);
    return !!acc && m.unread && (getMailAccount(acc)?.markReadOnOpen ?? false);
  });
  if (!due.length) return { marked: 0 };
  // In Zeff now: the mails, and the rows that show them.
  getDb().update(schema.emails).set({ unread: false }).where(inArray(schema.emails.key, due.map((m) => m.key))).run();
  // Every row that shows one of them — in this inbox, its other views, the other inboxes and the mail database alike.
  const refs = due.map((m) => `mail:${m.key}`);
  const rows = getSqlite().prepare(`select id from ws_pages where archived_at is null and json_extract(props, '$.srcref') in (${refs.map(() => "?").join(",")})`).all(...refs) as { id: number }[];
  for (const { id: row } of rows) {
    const cells = (getPage(row)?.props ?? {}) as Record<string, unknown>;
    for (const field of UNREAD) if (cells[field]) setCell(row, field, false, { quiet: true });
  }
  // On the server, without keeping the page waiting: per account, its IMAP mails by folder.
  const byAccount = new Map<string, { path: string; messageId: string }[]>();
  for (const m of due) {
    const a = getMailAccount(accountIdOfConv(m.convId)!);
    const path = a && a.method === "imap" ? serverFolderOf(a, m.folder) : null;
    if (!a || !path || !m.attachRef) continue;
    byAccount.set(a.id, [...(byAccount.get(a.id) ?? []), { path, messageId: m.attachRef }]);
  }
  for (const [id, items] of byAccount) {
    const a = getMailAccount(id)!;
    void markSeenImap(a, items, deps).catch((e: unknown) => saveMailAccount(id, { lastResult: `Gelesen-Markierung: ${e instanceof Error ? e.message : String(e)}`, lastOk: false }));
  }
  return { marked: due.length };
}
