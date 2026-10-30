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

/** The inbox's channels — its filters (the URL's `channel`): Outlook, Gmail, WhatsApp, Signal kept as mails, Teams in its own store. */
export const INBOX_CHANNELS = [
  { id: "outlook", name: "Outlook", plugin: "outlook-mail" },
  { id: "gmail", name: "Gmail", plugin: "gmail" },
  { id: "whatsapp", name: "WhatsApp", plugin: "whatsapp" },
  { id: "signal", name: "Signal", plugin: "signal" },
  { id: "teams", name: "Teams", plugin: "teams" },
] as const;
export type InboxChannel = (typeof INBOX_CHANNELS)[number]["id"];

/** The channel a stored message's folder belongs to ("Gmail · me@x.com" → gmail; any other mail folder → outlook). */
export const channelOfFolder = (folder: string): Exclude<InboxChannel, "teams"> =>
  folder === "WhatsApp" ? "whatsapp" : folder === "Signal" ? "signal" : folder.startsWith("Gmail") ? "gmail" : "outlook";

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

/** The stored sender name of your own messages (what the syncs write as `fromName`; shown as t("Me")). */
export const ME_SENDER = "Ich";

/** Whether a message (or a bare sender name) is yours. */
export const isMine = (m: Pick<MailView, "fromName"> | string | null | undefined): boolean => (typeof m === "string" ? m : m?.fromName) === ME_SENDER;

/** The inbox folder, as Outlook's German UI names it (the stored folder name). */
export const INBOX_FOLDER = "Posteingang";

/** Whether a folder is the inbox (Outlook: "Posteingang", also "Inbox"; Gmail's folders carry their own name). */
export const isInboxFolder = (folder: string) => folder === INBOX_FOLDER || folder.toLowerCase() === "inbox";

/** The Gmail thread of a message (its hex id), or null. */
export const gmailThreadOf = (convId: string) => /^gmail:(?:[^:]+:)?([0-9a-f]+)$/i.exec(convId)?.[1] ?? null;

/** The mail's thread in Gmail on the web — null for anything but a Gmail thread. The account is the folder's address ("Gmail · me@x.com"), else the first signed in (0). */
export const gmailLink = (m: Pick<MailView, "convId" | "folder">): string | null => {
  const thread = gmailThreadOf(m.convId);
  if (!thread) return null;
  const named = /^Gmail · (\S+@\S+)$/.exec(m.folder)?.[1];
  return `https://mail.google.com/mail/u/${encodeURIComponent(named ?? "0")}/#all/${thread}`;
};

/** A mail's source link — Outlook or Gmail — with the label to show. */
export const sourceLink = (m: Pick<MailView, "convId" | "folder">): { href: string; label: "Open in Outlook" | "Open in Gmail" } | null => {
  const o = outlookLink(m);
  if (o) return { href: o, label: "Open in Outlook" };
  const g = gmailLink(m);
  return g ? { href: g, label: "Open in Gmail" } : null;
};

/** Who wrote it, as shown. */
export const mailSender = (m: Pick<MailView, "fromName" | "fromEmail">) => m.fromName ?? m.fromEmail ?? "Mail";
