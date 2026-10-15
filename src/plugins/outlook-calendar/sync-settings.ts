import { driverOf } from "@/lib/connectors/store";
import { t } from "@/lib/i18n/server";
import { setStepMinutes, stepMinutes } from "@/lib/sync/intervals";
import { MINUTE_CHOICES, type PluginSyncSettings } from "../sync-settings";

/** Outlook Calendar's part of the Sync settings: your meetings, last month to next week. */
export const syncSettings: PluginSyncSettings = {
  intervals: [
    {
      key: "calendar",
      get label() {
        return t("Calendar");
      },
      get what() {
        return driverOf("outlook-calendar") === "api"
          ? t("Your Outlook meetings, last month to next week (read only) — through Microsoft Graph.")
          : t("Your Outlook meetings, last month to next week (read only).");
      },
      get: () => stepMinutes("calendar"),
      set: (m) => setStepMinutes("calendar", m),
      choices: MINUTE_CHOICES,
      get window() {
        return driverOf("outlook-calendar") === "api" ? t("always") : t("while the automation Chrome is running");
      },
    },
  ],
};
