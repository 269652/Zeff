import { setStepMinutes, stepMinutes } from "@/lib/sync/intervals";
import { MINUTE_CHOICES, type PluginSyncSettings } from "../sync-settings";

/** TimO's part of the Sync settings: what TimO has on this and last week's days (read only). */
export const syncSettings: PluginSyncSettings = {
  intervals: [
    {
      key: "timo",
      label: "TimO",
      what: "What TimO has for the days of this week and last (read only — entries are only made on your click).",
      get: () => stepMinutes("timo"),
      set: (m) => setStepMinutes("timo", m),
      choices: MINUTE_CHOICES,
      window: "while the automation Chrome is running",
    },
  ],
};
