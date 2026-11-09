import { t } from "@/lib/i18n/server";
import { setStepMinutes, stepMinutes } from "@/lib/sync/intervals";
import { MINUTE_CHOICES, type PluginSyncSettings } from "../sync-settings";

/** The Documents plugin's part of the Sync settings: its extensions' steps run with each briefing — nothing to set. */
export const syncSettings: PluginSyncSettings = {
  intervals: [
    {
      key: "localdocs",
      get label() {
        return t("Local folders");
      },
      get what() {
        return t("New and changed documents in the folders you chose (Settings → Documents) read in.");
      },
      get: () => stepMinutes("localdocs"),
      set: (m) => setStepMinutes("localdocs", m),
      choices: MINUTE_CHOICES,
    },
  ],
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
