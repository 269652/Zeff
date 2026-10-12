import { t } from "@/lib/i18n/server";
import type { PluginSyncSettings } from "../sync-settings";

/** The Documents plugin's part of the Sync settings: its extensions' steps run with each briefing — nothing to set. */
export const syncSettings: PluginSyncSettings = {
  intervals: [],
  follows: [
    {
      key: "doctodos",
      get label() {
        return t("Document review");
      },
      get follows() {
        return t("with every briefing — todos from new and changed documents");
      },
    },
    {
      key: "docrelations",
      get label() {
        return t("Document matching");
      },
      get follows() {
        return t("with every briefing — which documents belong to which todo");
      },
    },
  ],
};
