import { t } from "@/lib/i18n/server";
import { setStepMinutes, stepMinutes } from "@/lib/sync/intervals";
import { MINUTE_CHOICES, type PluginSyncSettings } from "../sync-settings";

/** Google Drive's part of the Sync settings: how often each of its two syncs runs by itself (a backup goes up at once, besides). */
export const syncSettings: PluginSyncSettings = {
  intervals: [
    {
      key: "drivedocs",
      get label() {
        return t("Documents → Google Drive");
      },
      get what() {
        return t("Your documents copied to Google Drive (and, if you set so, what you add there brought in).");
      },
      get: () => stepMinutes("drivedocs"),
      set: (m) => setStepMinutes("drivedocs", m),
      choices: MINUTE_CHOICES,
      get window() {
        return t("not in the quiet hours");
      },
    },
    {
      key: "drivebackup",
      get label() {
        return t("Backups → Google Drive");
      },
      get what() {
        return t("Your backups copied to Google Drive — each one at once when it is made; this catches up what was missed.");
      },
      get: () => stepMinutes("drivebackup"),
      set: (m) => setStepMinutes("drivebackup", m),
      choices: MINUTE_CHOICES,
      get window() {
        return t("not in the quiet hours");
      },
    },
  ],
};
