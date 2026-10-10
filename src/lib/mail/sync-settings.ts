import { MINUTE_CHOICES, type SyncFollower, type SyncInterval } from "@/plugins/sync-settings";
import { getMailSettings, updateMailSettings } from "./store";

/** The mail sync (Outlook Mail and Gmail share it: one sync reads both mailboxes). */
export const MAIL_INTERVAL: SyncInterval = {
  key: "mail",
  label: "Mail",
  what: "Your inbox's latest mails (Outlook, Gmail) — read from the list, none opened.",
  get: () => getMailSettings().syncMinutes,
  set: (m) => updateMailSettings({ syncMinutes: m }),
  choices: MINUTE_CHOICES,
  window: "while the automation Chrome runs",
};

/** What the mails (and WhatsApp messages) go through: with each Ticket-Lage. */
export const MAIL_FOLLOWERS: SyncFollower[] = [
  { key: "mailtodos", label: "Mail review", follows: "with each briefing — todos from new mails and WhatsApp messages" },
  { key: "relations", label: "Mail matching", follows: "with each briefing — which mails belong to which todo" },
];
