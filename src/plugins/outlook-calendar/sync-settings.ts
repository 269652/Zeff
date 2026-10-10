import { setStepMinutes, stepMinutes } from "@/lib/sync/intervals";
import { MINUTE_CHOICES, type PluginSyncSettings } from "../sync-settings";

/** Outlook Calendar's part of the Sync settings: your meetings, last month to next week. */
export const syncSettings: PluginSyncSettings = {
  intervals: [
    {
      key: "calendar",
      label: "Calendar",
      what: "Your Outlook meetings, last month to next week (read only).",
      get: () => stepMinutes("calendar"),
      set: (m) => setStepMinutes("calendar", m),
      choices: MINUTE_CHOICES,
      window: "while the automation Chrome is running",
    },
  ],
};
