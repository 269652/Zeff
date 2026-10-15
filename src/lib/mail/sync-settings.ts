import { MINUTE_CHOICES, type SyncFollower, type SyncInterval } from "@/plugins/sync-settings";
import { driverOf } from "@/lib/connectors/store";
import { t } from "@/lib/i18n/server";
import { getMailSettings, updateMailSettings } from "./store";

/** The mail sync (Outlook Mail and Gmail share it: one sync reads both mailboxes). */
export const MAIL_INTERVAL: SyncInterval = {
  key: "mail",
  get label() {
    return t("Mail");
  },
  get what() {
    return driverOf("gmail") === "api" || driverOf("outlook-mail") === "api"
      ? t("Your inbox's latest mails (Outlook, Gmail) — read from the list, none opened. A mailbox set to its API is read through it, the others through the automation Chrome.")
      : t("Your inbox's latest mails (Outlook, Gmail) — read from the list, none opened.");
  },
  get: () => getMailSettings().syncMinutes,
  set: (m) => updateMailSettings({ syncMinutes: m }),
  choices: MINUTE_CHOICES,
  get window() {
    return driverOf("gmail") === "api" || driverOf("outlook-mail") === "api" ? t("A mailbox through its API always, the others while the automation Chrome runs") : t("while the automation Chrome runs");
  },
};

/** What the mails (and WhatsApp messages) go through: with each Ticket-Lage. Texts in the account's language, when read. */
export const MAIL_FOLLOWERS: SyncFollower[] = [
  {
    key: "mailtodos",
    get label() {
      return t("Mail review");
    },
    get follows() {
      return t("with each briefing — todos from new mails and WhatsApp messages");
    },
  },
  {
    key: "mailattachments",
    get label() {
      return t("Mail attachments");
    },
    get follows() {
      return t("with each mail sync — attachments into Documents, only if turned on (Messages page → Mail attachments)");
    },
  },
  {
    key: "relations",
    get label() {
      return t("Mail matching");
    },
    get follows() {
      return t("with each briefing — which mails belong to which todo");
    },
  },
];
