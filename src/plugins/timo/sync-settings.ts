import { setStepMinutes, stepMinutes } from "@/lib/sync/intervals";
import { MINUTE_CHOICES, type PluginSyncSettings } from "../sync-settings";

/** TimO's part of the Sync settings: what TimO has on this and last week's days (read only). */
export const syncSettings: PluginSyncSettings = {
  intervals: [
    {
      key: "timo",
      label: "TimO",
      what: "Was TimO für die Tage dieser und letzter Woche hat (nur gelesen — eingetragen wird nur auf deinen Klick).",
      get: () => stepMinutes("timo"),
      set: (m) => setStepMinutes("timo", m),
      choices: MINUTE_CHOICES,
      window: "solange der Automations-Chrome läuft",
    },
  ],
};
