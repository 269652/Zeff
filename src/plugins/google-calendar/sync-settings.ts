import { setStepMinutes, stepMinutes } from "@/lib/sync/intervals";
import { MINUTE_CHOICES, type PluginSyncSettings } from "../sync-settings";

/** Google Calendar's part of the Sync settings: its own sync. */
export const syncSettings: PluginSyncSettings = {
  intervals: [
    {
      key: "gcalendar",
      label: "Google Calendar",
      what: "Deine Google-Kalender — die Wochenansicht wird in einem neuen Tab gelesen, Woche für Woche, der Tab wieder geschlossen. In Google ändert sich nichts.",
      get: () => stepMinutes("gcalendar"),
      set: (m) => setStepMinutes("gcalendar", m),
      choices: MINUTE_CHOICES,
      window: "solange der Automations-Chrome läuft",
    },
  ],
};
