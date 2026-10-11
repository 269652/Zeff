import { t } from "@/lib/i18n/server";
import type { PluginSyncSettings } from "../sync-settings";

/** Jira Lage's part of the Sync settings: the Board-Lage runs only by hand. */
export const syncSettings: PluginSyncSettings = {
  follows: [
    {
      key: "boardlage",
      get label() {
        return t("Board briefing");
      },
      get follows() {
        return t("by hand only — “Analyse” on a Jira board");
      },
    },
  ],
};
