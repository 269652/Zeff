import { ME_SENDER } from "@/lib/mail/shared";
import { sentOf } from "@/lib/mail/mirror";
import type { MailInput } from "@/lib/mail/store";
import { imapConv } from "./config";

/**
 * A message read over IMAP or POP3 as Zeff keeps it (a MailInput): its conversation from its Message-IDs, yours marked as the other
 * mailboxes do (sender "Ich", in "<mailbox> · Sent"), unread as the server's \Seen flag says. Pure; server only (it reaches
 * the store's types only).
 */

/** What the reader hands over of a parsed message (mailparser's simpleParser gives these). */
export type ParsedMail = {
  messageId?: string;
  references?: string | string[];
  inReplyTo?: string;
  from?: { value?: { name?: string; address?: string }[] };
  subject?: string;
  date?: Date;
  text?: string;
  html?: string | false;
};

/** Where the message was read and what the server said of it. */
export type ImapMeta = {
  /** The account it was read from (its conversations are "imap:<account>:<thread>"). */
  account: string;
  /** The folder's path on the server, its UIDVALIDITY and the message's UID (its id when it has no Message-ID). */
  path: string;
  uidValidity: string;
  uid: number;
  flags: Iterable<string>;
  internalDate?: Date | string | null;
  hasAttachments: boolean;
  /** The folder's name in Zeff ("T-Online", "T-Online · Work"). */
  folder: string;
  /** The mailbox's name (yours go to "<name> · Sent"). */
  mailbox: string;
  /** Read in the Sent folder: yours, whoever it says it is from. */
  sent: boolean;
  /** Your address (a message from it is yours). */
  me: string;
};

/** "<a@b>" → "a@b"; several ("<a@b> <c@d>") → each. */
export const messageIds = (v: string | string[] | undefined): string[] =>
  (Array.isArray(v) ? v : [v ?? ""]).flatMap((x) => String(x).match(/<[^<>\s]+>|[^<>\s,]+@[^<>\s,]+/g) ?? []).map((x) => x.replace(/^<|>$/g, "").trim()).filter(Boolean);

/** The conversation a message is in: the first Message-ID of its References (the thread's start), else what it answers, else its own. */
export function threadKey(p: Pick<ParsedMail, "references" | "inReplyTo" | "messageId">): string | null {
  return messageIds(p.references)[0] ?? messageIds(p.inReplyTo)[0] ?? messageIds(p.messageId)[0] ?? null;
}

/** An HTML-only mail's text: tags out, entities of the common kind decoded. */
export const htmlText = (html: string): string =>
  html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

/** A message's text as kept: the quoted part of a reply ("> …" lines) left out, blank runs closed, at most 1000 characters. */
export function previewOf(p: Pick<ParsedMail, "text" | "html">): string {
  const raw = p.text?.trim() ? p.text : typeof p.html === "string" ? htmlText(p.html) : "";
  return raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((l) => !/^\s*>/.test(l))
    .map((l) => l.replace(/[ \t ]+/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 1000);
}

const iso = (v: Date | string | null | undefined): string | null => {
  const d = v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
};

/** The message as Zeff keeps it. */
export function toMailInput(p: ParsedMail, m: ImapMeta): MailInput {
  const own = messageIds(p.messageId)[0];
  const id = own ?? `${m.account}:${m.path}:${m.uidValidity}:${m.uid}`;
  const sender = p.from?.value?.[0] ?? {};
  const address = sender.address?.trim() || null;
  const mine = m.sent || (!!address && !!m.me && address.toLowerCase() === m.me.trim().toLowerCase());
  const flags = new Set([...m.flags].map((f) => f.toLowerCase()));
  return {
    id,
    full: true,
    convId: imapConv(m.account, threadKey(p) ?? id),
    folder: mine ? sentOf(m.mailbox) : m.folder,
    from: mine ? ME_SENDER : sender.name?.trim() || address || "",
    fromEmail: mine ? null : address,
    subject: p.subject?.trim() || "(ohne Betreff)",
    preview: previewOf(p),
    receivedAt: iso(p.date) ?? iso(m.internalDate),
    unread: !mine && !flags.has("\\seen"),
    hasAttachments: m.hasAttachments,
    // (The Message-ID: what a reply names in In-Reply-To / References.)
    ...(own ? { attachRef: own } : {}),
  };
}

/** Whether a message's structure has an attachment (a part given as one, or a named file that isn't inline text). */
export function hasAttachment(node: { disposition?: string; dispositionParameters?: Record<string, string>; parameters?: Record<string, string>; type?: string; childNodes?: unknown[] } | undefined): boolean {
  if (!node) return false;
  if (node.disposition?.toLowerCase() === "attachment") return true;
  if (node.disposition?.toLowerCase() !== "inline" && (node.dispositionParameters?.filename || node.parameters?.name) && !/^text\//i.test(node.type ?? "")) return true;
  return (node.childNodes ?? []).some((c) => hasAttachment(c as Parameters<typeof hasAttachment>[0]));
}
