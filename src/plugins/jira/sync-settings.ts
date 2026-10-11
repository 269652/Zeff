import { t } from "@/lib/i18n/server";
import { setStepMinutes, stepMinutes } from "@/lib/sync/intervals";
import { MINUTE_CHOICES, type PluginSyncSettings } from "../sync-settings";

/** Jira's part of the Sync settings: your tickets and the chosen boards' tickets. */
export const syncSettings: PluginSyncSettings = {
  intervals: [
    {
      key: "jira",
      label: "Jira",
      get what() {
        return t("Your tickets and those of the chosen boards (status, comments, history).");
      },
      get: () => stepMinutes("jira"),
      set: (m) => setStepMinutes("jira", m),
      choices: MINUTE_CHOICES,
    },
  ],
};
