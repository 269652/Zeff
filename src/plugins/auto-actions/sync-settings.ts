import { t } from "@/lib/i18n/server";
import type { PluginSyncSettings } from "../sync-settings";

/** Auto-Aktionen's part of the Sync settings: it runs with the Ticket-Lage (its last step). */
export const syncSettings: PluginSyncSettings = {
  follows: [
    {
      key: "autoactions",
      get label() {
        return t("Auto actions");
      },
      get follows() {
        return t("with every briefing (its last step) — ready-made actions for the todos without a button");
      },
    },
  ],
};
