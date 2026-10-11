import { t } from "@/lib/i18n/server";
import { MAIL_FOLLOWERS } from "@/lib/mail/sync-settings";
import { setStepMinutes, stepMinutes } from "@/lib/sync/intervals";
import { MINUTE_CHOICES, type PluginSyncSettings } from "../sync-settings";

/** Signal's part of the Sync settings: its own sync, and the Durchsicht its messages go through. */
export const syncSettings: PluginSyncSettings = {
  intervals: [
    {
      key: "signal",
      label: "Signal",
      get what() {
        return t("The messages of your active Signal chats — from Signal Desktop, no chat opened, nothing marked as read.");
      },
      get: () => stepMinutes("signal"),
      set: (m) => setStepMinutes("signal", m),
      choices: MINUTE_CHOICES,
      get window() {
        return t("while Signal Desktop runs");
      },
    },
  ],
  follows: MAIL_FOLLOWERS,
};
