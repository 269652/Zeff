import { t } from "@/lib/i18n/server";
import { setStepMinutes, stepMinutes } from "@/lib/sync/intervals";
import { MINUTE_CHOICES, type PluginSyncSettings } from "../sync-settings";

/** News's part of the Sync settings: its own sync. */
export const syncSettings: PluginSyncSettings = {
  intervals: [
    {
      key: "news",
      label: "News",
      get what() {
        return t("Your sources and interest searches — fetched, scored for you, old items removed. Public feeds, nothing of yours is sent.");
      },
      get: () => stepMinutes("news"),
      set: (m) => setStepMinutes("news", m),
      choices: MINUTE_CHOICES,
    },
  ],
};
