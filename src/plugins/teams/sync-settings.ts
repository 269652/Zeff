import { driverOf } from "@/lib/connectors/store";
import { t } from "@/lib/i18n/server";
import { getTeamsSettings, updateTeamsSettings } from "@/lib/teams/store";
import { MINUTE_CHOICES, type PluginSyncSettings } from "../sync-settings";

/** Teams' part of the Sync settings: your mentions, PMs and the chats' latest messages. */
export const syncSettings: PluginSyncSettings = {
  intervals: [
    {
      key: "teams",
      label: "Teams",
      get what() {
        return driverOf("teams") === "api"
          ? t("Your mentions in chats, 1:1 messages and the last few days of your chats — through Microsoft Graph (channel messages are not read this way).")
          : t("Your mentions, 1:1 messages and the last few days of your chats — from Teams Web in the automation Chrome.");
      },
      get: () => getTeamsSettings().syncMinutes,
      set: (m) => updateTeamsSettings({ syncMinutes: m }),
      choices: MINUTE_CHOICES,
      get window() {
        return driverOf("teams") === "api" ? t("always") : t("while the automation Chrome is running");
      },
    },
  ],
};
