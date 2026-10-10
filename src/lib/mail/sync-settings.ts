import { MINUTE_CHOICES, type SyncFollower, type SyncInterval } from "@/plugins/sync-settings";
import { getMailSettings, updateMailSettings } from "./store";

/** The mail sync (Outlook Mail and Gmail share it: one sync reads both mailboxes). */
export const MAIL_INTERVAL: SyncInterval = {
  key: "mail",
  label: "Mail",
  what: "Die neuesten Mails deines Posteingangs (Outlook, Gmail) — aus der Liste gelesen, keine geöffnet.",
  get: () => getMailSettings().syncMinutes,
  set: (m) => updateMailSettings({ syncMinutes: m }),
  choices: MINUTE_CHOICES,
  window: "solange der Automations-Chrome läuft",
};

/** What the mails (and WhatsApp messages) go through: with each Ticket-Lage. */
export const MAIL_FOLLOWERS: SyncFollower[] = [
  { key: "mailtodos", label: "Mail-Durchsicht", follows: "mit jeder Ticket-Lage (Auswertung) — Todos aus neuen Mails und WhatsApp-Nachrichten" },
  { key: "relations", label: "Mail-Zuordnung", follows: "mit jeder Ticket-Lage — welche Mails zu welchem Todo gehören" },
];
