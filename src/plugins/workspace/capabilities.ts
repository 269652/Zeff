import { googleGrants } from "@/lib/google/grants";
import { opAvailable } from "@/plugins/ops";
import type { DbSchema } from "./model";

/**
 * What a database's sources let you do — the hint its views go by: a source that can be written to gets the full client
 * (a reply field, sending), a read-only one its read-only version. Writable is what Zeff's installed actions write to: mail
 * as a draft (Outlook; Gmail — opened for you to send, or sent by Zeff through Gmail's API once you allowed it), messages sent
 * (Teams, WhatsApp, Signal).
 */
export type Capabilities = {
  /** The channels a reply goes out through ("Outlook", "Gmail", "Teams", "WhatsApp", "Signal"). */
  reply: string[];
  /** Of them, the ones whose reply is a draft you send yourself (mail). */
  drafts: string[];
  /** Of them, the mail Zeff sends itself on your click (Gmail, with its write access — or saved as a draft there; an IMAP mailbox over its SMTP server). */
  sends: string[];
  /** Nothing to write back. */
  readOnly: boolean;
};

/** Each channel and the action that writes to it (a draft: opened for you; else sent by Zeff). */
export const WRITE_CHANNELS = [
  { channel: "outlook", name: "Outlook", action: "mail-compose", draft: true, source: "mail" },
  { channel: "gmail", name: "Gmail", action: "gmail-compose", draft: true, source: "mail" },
  { channel: "imap", name: "E-Mail", action: "imap-send", draft: false, source: "mail" },
  { channel: "teams", name: "Teams", action: "teams-message", draft: false, source: "messages" },
  { channel: "whatsapp", name: "WhatsApp", action: "whatsapp-message", draft: false, source: "messages" },
  { channel: "signal", name: "Signal", action: "signal-message", draft: false, source: "messages" },
] as const;

export function capabilitiesOf(schema: DbSchema): Capabilities {
  const reply = new Set<string>();
  const drafts = new Set<string>();
  const sends = new Set<string>();
  const gmailSends = googleGrants().includes("gmail-send");
  // A derived database (reads another): what it reads is what it is — mail, messages.
  const kinds = new Set((schema.pipeline?.steps ?? []).filter((s) => s.kind === "source").flatMap((s) => (s.from === "database" ? (schema.dataType === "mail" ? ["mail"] : schema.dataType === "message" ? ["messages"] : schema.dataType === "inbox" ? ["mail", "messages"] : []) : [s.from])));
  for (const s of schema.pipeline?.steps ?? []) {
    if (s.kind !== "source") continue;
    const channels: readonly string[] | undefined = s.from === "mail" ? s.mail?.accounts : s.from === "messages" ? s.messages?.channels : undefined;
    for (const x of WRITE_CHANNELS) {
      if (!kinds.has(x.source)) continue;
      if (channels?.length && (s.from === "mail" || s.from === "messages") && !channels.includes(x.channel)) continue;
      if (!opAvailable(x.action)) continue;
      reply.add(x.name);
      if ((x.channel === "gmail" && gmailSends) || x.channel === "imap") sends.add(x.name);
      else if (x.draft) drafts.add(x.name);
    }
  }
  return { reply: [...reply], drafts: [...drafts], sends: [...sends], readOnly: reply.size === 0 };
}
