import { t } from "@/lib/i18n/server";
import { setStepMinutes, stepMinutes } from "@/lib/sync/intervals";
import { MINUTE_CHOICES, type PluginSyncSettings } from "../sync-settings";

/** Google Calendar's part of the Sync settings: its own sync. */
export const syncSettings: PluginSyncSettings = {
  intervals: [
    {
      key: "gcalendar",
      label: "Google Calendar",
      get what() {
        return t("Your Google calendars — the week view is read in a new tab, week by week, then the tab is closed again. Nothing changes in Google.");
      },
      get: () => stepMinutes("gcalendar"),
      set: (m) => setStepMinutes("gcalendar", m),
      choices: MINUTE_CHOICES,
      get window() {
        return t("while the automation Chrome is running");
      },
    },
  ],
};
