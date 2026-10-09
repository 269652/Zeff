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

/** A mail's link, as a context item or a todo keeps it (it has no address of its own Zeff can open). */
export const mailLink = (key: string) => `zeff:mail:${key}`;

/** The mail a link points at ("zeff:mail:<key>", or a todo's ref "mail:<key>"), or null. */
export const mailKeyOfLink = (url: string) => /^(?:zeff:)?mail:(.+)$/.exec(url.trim())?.[1] ?? null;

/** Who wrote it, as shown. */
export const mailSender = (m: Pick<MailView, "fromName" | "fromEmail">) => m.fromName ?? m.fromEmail ?? "Mail";
