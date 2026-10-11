import { t } from "@/lib/i18n/server";
import { getGitlabSettings, updateGitlabSettings } from "@/lib/gitlab/store";
import { MINUTE_CHOICES, type PluginSyncSettings } from "../sync-settings";

/** GitLab's part of the Sync settings: merge requests, their comments, your branches. */
export const syncSettings: PluginSyncSettings = {
  intervals: [
    {
      key: "gitlab",
      label: "GitLab",
      get what() {
        return t("Merge requests, their comments and your branches — through a GitLab tab in the automation Chrome.");
      },
      get: () => getGitlabSettings().syncMinutes,
      set: (m) => updateGitlabSettings({ syncMinutes: m }),
      choices: MINUTE_CHOICES,
      get window() {
        return t("while the automation Chrome is running");
      },
    },
  ],
};
