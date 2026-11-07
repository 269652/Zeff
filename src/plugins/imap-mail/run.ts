/**
 * A mail account's mail (IMAP or POP3) sent over its SMTP server — only from the reply's (or a new mail's) own "Send", your click: into the conversation it
 * answers (In-Reply-To / References from the messages kept of it), then kept with the mails as yours ("<mailbox> · Sent") so
 * the conversation shows it at once, and noted on the timeline. Server only.
 */
import type { TodoOp } from "@/lib/todos/shared";
import { asc, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { saveMails } from "@/lib/mail/store";
import { ME_SENDER } from "@/lib/mail/shared";
import { sentOf } from "@/lib/mail/mirror";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import type { ActionResult } from "../actions/run-types";
import { accountIdOfConv, accountReady, getMailAccount, IMAP_CONV, imapConv, mailAccounts, mailboxName } from "./config";
import { sendImapMail, type MailDeps } from "./client";

type Send = Extract<TodoOp, { type: "imap-send" }>;

/** What a reply in this conversation names: the message it answers (the newest kept) and the thread's ids, its start first. */
export function replyHeaders(conv: string | null | undefined): { inReplyTo?: string; references?: string[] } {
  if (!conv || !IMAP_CONV.test(conv)) return {};
  // (An IMAP message's Message-ID is kept as its attachRef.)
  const ids = getDb()
    .select({ id: schema.emails.attachRef })
    .from(schema.emails)
    .where(sql`${schema.emails.convId} = ${conv}`)
    .orderBy(asc(schema.emails.receivedAt))
    .all()
    .flatMap((r) => (r.id ? [r.id] : []));
  const root = IMAP_CONV.exec(conv)![2];
  const references = [...new Set([root, ...ids])].filter(Boolean);
  // (At most 20: the start, and the latest.)
  return { inReplyTo: ids.at(-1) ?? root, references: references.length > 20 ? [references[0], ...references.slice(-19)] : references };
}

/**
 * The mail sent over its account's SMTP server — into `conv` when it answers one (the account the conversation is in), else from
 * the account the op names (a new mail), else the only one.
 */
export async function runImapSend(op: Send, o: { conv?: string | null; refs?: string[] } = {}, deps: MailDeps = {}): Promise<ActionResult> {
  const conv = o.conv && IMAP_CONV.test(o.conv) ? o.conv : null;
  const all = mailAccounts();
  const c = getMailAccount(accountIdOfConv(conv) ?? op.account ?? "") ?? (all.length === 1 ? all[0] : null);
  if (!c) throw new Error(all.length ? t("Pick the account to send from.") : t("Add a mail account first (Settings → E-Mail)."));
  if (!accountReady(c)) throw new Error(t("{account}: fill in the address, the password and both servers first (Settings → E-Mail).", { account: mailboxName(c) }));
  const r = await sendImapMail(c, { to: op.to, subject: op.subject, body: op.body, ...replyHeaders(conv) }, deps);
  // Kept as yours at once (the next sync reads the same message from the Sent folder: the same id, the same row).
  saveMails([
    {
      id: r.messageId,
      full: true,
      convId: conv ?? imapConv(c.id, r.messageId),
      folder: sentOf(mailboxName(c)),
      from: ME_SENDER,
      fromEmail: null,
      subject: op.subject || "(ohne Betreff)",
      preview: op.body.slice(0, 1000),
      receivedAt: new Date().toISOString(),
      unread: false,
      hasAttachments: false,
      attachRef: r.messageId,
    },
  ]);
  const to = r.to.join(", ");
  try {
    if (isInstalled("timeline"))
      void import("@/plugins/timeline/store")
        .then(({ recordEvent }) => recordEvent({ at: new Date().toISOString(), kind: "mail.sent", source: "imap", sourceRef: r.messageId, title: op.subject, summary: `→ ${to}`, refs: o.refs }))
        .catch(() => {});
  } catch {
    // (no timeline: nothing to note)
  }
  const what = t("Mail “{subject}” sent to {to} ({account}).", { subject: op.subject, to, account: mailboxName(c) });
  return { what: r.copy ? `${what} ${r.copy}` : what, todoNote: what };
}
