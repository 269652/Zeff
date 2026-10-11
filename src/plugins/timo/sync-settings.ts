import { t } from "@/lib/i18n/server";
import { setStepMinutes, stepMinutes } from "@/lib/sync/intervals";
import { MINUTE_CHOICES, type PluginSyncSettings } from "../sync-settings";

/** TimO's part of the Sync settings: what TimO has on this and last week's days (read only). */
export const syncSettings: PluginSyncSettings = {
  intervals: [
    {
      key: "timo",
      label: "TimO",
      get what() {
        return t("What TimO has for the days of this week and last (read only — entries are only made on your click).");
      },
      get: () => stepMinutes("timo"),
      set: (m) => setStepMinutes("timo", m),
      choices: MINUTE_CHOICES,
      get window() {
        return t("while the automation Chrome is running");
      },
    },
  ],
};
