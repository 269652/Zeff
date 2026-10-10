import { getTeamsSettings, updateTeamsSettings } from "@/lib/teams/store";
import { MINUTE_CHOICES, type PluginSyncSettings } from "../sync-settings";

/** Teams' part of the Sync settings: your mentions, PMs and the chats' latest messages. */
export const syncSettings: PluginSyncSettings = {
  intervals: [
    {
      key: "teams",
      label: "Teams",
      what: "Your mentions, 1:1 messages and the last few days of your chats — from Teams Web in the automation Chrome.",
      get: () => getTeamsSettings().syncMinutes,
      set: (m) => updateTeamsSettings({ syncMinutes: m }),
      choices: MINUTE_CHOICES,
      window: "while the automation Chrome is running",
    },
  ],
};
