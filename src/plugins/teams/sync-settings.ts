import { getTeamsSettings, updateTeamsSettings } from "@/lib/teams/store";
import { MINUTE_CHOICES, type PluginSyncSettings } from "../sync-settings";

/** Teams' part of the Sync settings: your mentions, PMs and the chats' latest messages. */
export const syncSettings: PluginSyncSettings = {
  intervals: [
    {
      key: "teams",
      label: "Teams",
      what: "Deine Erwähnungen, 1:1-Nachrichten und die letzten Tage deiner Chats — aus Teams Web im Automations-Chrome.",
      get: () => getTeamsSettings().syncMinutes,
      set: (m) => updateTeamsSettings({ syncMinutes: m }),
      choices: MINUTE_CHOICES,
      window: "solange der Automations-Chrome läuft",
    },
  ],
};
