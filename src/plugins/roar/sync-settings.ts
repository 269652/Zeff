import { setStepMinutes, stepMinutes } from "@/lib/sync/intervals";
import { MINUTE_CHOICES, type PluginSyncSettings } from "../sync-settings";

/** Roar's part of the Sync settings: your entries' approvals (read only). */
export const syncSettings: PluginSyncSettings = {
  intervals: [
    {
      key: "roar",
      label: "Roar",
      what: "The approvals of your Roar entries, last month and this one (read only — entries are only sent on your click).",
      get: () => stepMinutes("roar"),
      set: (m) => setStepMinutes("roar", m),
      choices: MINUTE_CHOICES,
      window: "while the automation Chrome is running",
    },
  ],
};
