import { t } from "@/lib/i18n/server";
import { MAIL_FOLLOWERS } from "@/lib/mail/sync-settings";
import { setStepMinutes, stepMinutes } from "@/lib/sync/intervals";
import { MINUTE_CHOICES, type PluginSyncSettings } from "../sync-settings";

/** WhatsApp's part of the Sync settings: its own sync, and the Durchsicht its messages go through. */
export const syncSettings: PluginSyncSettings = {
  intervals: [
    {
      key: "whatsapp",
      label: "WhatsApp",
      get what() {
        return t("The last message of every chat — from WhatsApp Web's chat list, no chat opened. The more often, the fewer messages get lost between two syncs.");
      },
      get: () => stepMinutes("whatsapp"),
      set: (m) => setStepMinutes("whatsapp", m),
      choices: MINUTE_CHOICES,
      get window() {
        return t("while the automation Chrome is running");
      },
    },
  ],
  follows: MAIL_FOLLOWERS,
};
