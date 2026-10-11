import { t } from "@/lib/i18n/server";
import { setStepMinutes, stepMinutes } from "@/lib/sync/intervals";
import { MINUTE_CHOICES, type PluginSyncSettings } from "../sync-settings";

/** Roar's part of the Sync settings: your entries' approvals (read only). */
export const syncSettings: PluginSyncSettings = {
  intervals: [
    {
      key: "roar",
      label: "Roar",
      get what() {
        return t("The approvals of your Roar entries, last month and this one (read only — entries are only sent on your click).");
      },
      get: () => stepMinutes("roar"),
      set: (m) => setStepMinutes("roar", m),
      choices: MINUTE_CHOICES,
      get window() {
        return t("while the automation Chrome is running");
      },
    },
  ],
};
