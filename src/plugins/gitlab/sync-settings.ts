import { getGitlabSettings, updateGitlabSettings } from "@/lib/gitlab/store";
import { MINUTE_CHOICES, type PluginSyncSettings } from "../sync-settings";

/** GitLab's part of the Sync settings: merge requests, their comments, your branches. */
export const syncSettings: PluginSyncSettings = {
  intervals: [
    {
      key: "gitlab",
      label: "GitLab",
      what: "Merge Requests, ihre Kommentare und deine Branches — über einen GitLab-Tab im Automations-Chrome.",
      get: () => getGitlabSettings().syncMinutes,
      set: (m) => updateGitlabSettings({ syncMinutes: m }),
      choices: MINUTE_CHOICES,
      window: "solange der Automations-Chrome läuft",
    },
  ],
};
