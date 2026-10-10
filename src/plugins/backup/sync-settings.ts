import { getAppSettings, updateAppSettings } from "@/lib/ai";
import type { PluginSyncSettings } from "../sync-settings";

/** Backup's part of the Sync settings: how often a backup is made (the rest under Settings → Backups). */
export const syncSettings: PluginSyncSettings = {
  intervals: [
    {
      key: "backup",
      label: "Backup",
      what: "A backup of the database (retention, folder and password under Settings → Backups).",
      get: () => {
        const s = getAppSettings();
        return s.backupEnabled ? s.backupEveryHours * 60 : 0;
      },
      // Off: no backups by themselves; else every N hours (at least one).
      set: (m) => updateAppSettings(m ? { backupEnabled: true, backupEveryHours: Math.max(1, Math.round(m / 60)) } : { backupEnabled: false }),
      choices: [0, 60, 180, 360, 720, 1440, 10080],
      window: "at any hour, at night too",
    },
  ],
};
