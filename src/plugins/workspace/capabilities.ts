import { isInstalled } from "@/plugins/state";
import type { DbSchema } from "./model";

/**
 * What a database's sources let you do — the hint its views go by: a source that can be written to gets the full client
 * (a reply field, sending), a read-only one its read-only version. Messages: the channels whose plugin sends (Teams,
 * WhatsApp, Signal); mails: read-only for now (Zeff doesn't send mail itself — Open in Outlook / Gmail).
 */
export type Capabilities = { /** The channels a reply goes out through ("Teams", "WhatsApp", "Signal"). */ reply: string[]; /** Nothing to write back. */ readOnly: boolean };

const SENDERS = [
  { channel: "teams", name: "Teams", plugin: "teams" },
  { channel: "whatsapp", name: "WhatsApp", plugin: "whatsapp" },
  { channel: "signal", name: "Signal", plugin: "signal" },
] as const;

export function capabilitiesOf(schema: DbSchema): Capabilities {
  const reply = new Set<string>();
  for (const s of schema.pipeline?.steps ?? []) {
    if (s.kind !== "source" || s.from !== "messages") continue;
    const channels = s.messages?.channels?.length ? s.messages.channels : SENDERS.map((x) => x.channel);
    for (const x of SENDERS) if ((channels as readonly string[]).includes(x.channel) && isInstalled(x.plugin)) reply.add(x.name);
  }
  return { reply: [...reply], readOnly: reply.size === 0 };
}
