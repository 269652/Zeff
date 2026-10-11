import { t } from "@/lib/i18n/server";
import type { PluginSyncSettings } from "../sync-settings";

/** Knowledge's part of the Sync settings: the Wissens-Zuordnung runs with the Ticket-Lage. */
export const syncSettings: PluginSyncSettings = {
  follows: [
    {
      key: "knowledgerel",
      get label() {
        return t("Knowledge matching");
      },
      get follows() {
        return t("with every briefing — which knowledge fits which todo (new and changed todos only)");
      },
    },
  ],
};
