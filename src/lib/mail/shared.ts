/** Mails (Outlook's inbox, as its list shows them) — the parts pages and the server share. Client-safe. */

export type MailView = {
  key: string;
  convId: string;
  /** The folder it was read in ("Posteingang", "Notifications"). */
  folder: string;
  fromName: string | null;
  fromEmail: string | null;
  subject: string;
  /** What the list shows of it (its first lines). */
  preview: string;
  receivedAt: string;
  unread: boolean;
  resolvedAt: string | null;
};

/** Where a document came from: the mail an attachment was taken from (Documents list and detail show it). */
export type DocOrigin = { mailKey: string; source: "outlook" | "gmail"; subject: string; from: string; receivedAt: string; file: string };

/** The chat apps whose messages the sync keeps with the mails — each in a folder of its name. */
export const CHAT_FOLDERS = ["WhatsApp", "Signal"] as const;
export type ChatFolder = (typeof CHAT_FOLDERS)[number];

/** Whether a message is a chat's (WhatsApp, Signal) — not a mail. */
export const isChatFolder = (folder: string): folder is ChatFolder => (CHAT_FOLDERS as readonly string[]).includes(folder);

/** A chat's conversation (its id: "wa:<chat>", "sg:<chat>"). */
export const isChatConv = (convId: string) => /^(wa|sg):/.test(convId);

/** Whether a step's sources (Auswerten settings) take this message: a chat's by its app, a mail's as "mail". */
export const sourceOn = (sources: Record<string, boolean>, folder: string) => (folder === "WhatsApp" ? sources.whatsapp : folder === "Signal" ? sources.signal : sources.mail);

/** A mail's link, as a context item or a todo keeps it (it has no address of its own Zeff can open). */
export const mailLink = (key: string) => `zeff:mail:${key}`;

/** The mail a link points at ("zeff:mail:<key>", or a todo's ref "mail:<key>"), or null. */
export const mailKeyOfLink = (url: string) => /^(?:zeff:)?mail:(.+)$/.exec(url.trim())?.[1] ?? null;

/** The mail's conversation in Outlook on the web — null for a chat's message or a Gmail thread. */
export const outlookLink = (m: Pick<MailView, "convId" | "folder">): string | null =>
  !m.convId || isChatFolder(m.folder) || isChatConv(m.convId) || m.convId.startsWith("gmail:")
    ? null
    : `https://outlook.office.com/mail/inbox/id/${encodeURIComponent(m.convId)}`;

/** Who wrote it, as shown. */
export const mailSender = (m: Pick<MailView, "fromName" | "fromEmail">) => m.fromName ?? m.fromEmail ?? "Mail";
