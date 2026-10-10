import { setStepMinutes, stepMinutes } from "@/lib/sync/intervals";
import { MINUTE_CHOICES, type PluginSyncSettings } from "../sync-settings";

/** Google Calendar's part of the Sync settings: its own sync. */
export const syncSettings: PluginSyncSettings = {
  intervals: [
    {
      key: "gcalendar",
      label: "Google Calendar",
      what: "Your Google calendars — the week view is read in a new tab, week by week, then the tab is closed again. Nothing changes in Google.",
      get: () => stepMinutes("gcalendar"),
      set: (m) => setStepMinutes("gcalendar", m),
      choices: MINUTE_CHOICES,
      window: "while the automation Chrome is running",
    },
  ],
};
