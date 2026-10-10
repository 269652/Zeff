import { setStepMinutes, stepMinutes } from "@/lib/sync/intervals";
import { MINUTE_CHOICES, type PluginSyncSettings } from "../sync-settings";

/** Roar's part of the Sync settings: your entries' approvals (read only). */
export const syncSettings: PluginSyncSettings = {
  intervals: [
    {
      key: "roar",
      label: "Roar",
      what: "Die Freigaben deiner Roar-Einträge, letzter und dieser Monat (nur gelesen — übertragen wird nur auf deinen Klick).",
      get: () => stepMinutes("roar"),
      set: (m) => setStepMinutes("roar", m),
      choices: MINUTE_CHOICES,
      window: "solange der Automations-Chrome läuft",
    },
  ],
};
