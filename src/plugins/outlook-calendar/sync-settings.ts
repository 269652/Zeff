import { setStepMinutes, stepMinutes } from "@/lib/sync/intervals";
import { MINUTE_CHOICES, type PluginSyncSettings } from "../sync-settings";

/** Outlook Calendar's part of the Sync settings: your meetings, last month to next week. */
export const syncSettings: PluginSyncSettings = {
  intervals: [
    {
      key: "calendar",
      label: "Kalender",
      what: "Deine Outlook-Termine, letzter Monat bis nächste Woche (nur gelesen).",
      get: () => stepMinutes("calendar"),
      set: (m) => setStepMinutes("calendar", m),
      choices: MINUTE_CHOICES,
      window: "solange der Automations-Chrome läuft",
    },
  ],
};
