import type { PluginSyncSettings } from "../sync-settings";

/** Jira Lage's part of the Sync settings: the Board-Lage runs only by hand. */
export const syncSettings: PluginSyncSettings = {
  follows: [{ key: "boardlage", label: "Board briefing", follows: "by hand only — “Analyse” on a Jira board" }],
};
