import { t } from "@/lib/i18n/server";
import type { PluginSyncSettings } from "../sync-settings";

/** The Calendar's part of the Sync settings: its step that runs with every briefing. */
export const syncSettings: PluginSyncSettings = {
  follows: [
    {
      key: "calendarrelations",
      get label() {
        return t("Calendar matching");
      },
      get follows() {
        return t("with every briefing — which appointments belong to which todo");
      },
    },
  ],
};
