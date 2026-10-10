import type { PluginSyncSettings } from "../sync-settings";

/** Knowledge's part of the Sync settings: the Wissens-Zuordnung runs with the Ticket-Lage. */
export const syncSettings: PluginSyncSettings = {
  follows: [{ key: "knowledgerel", label: "Knowledge matching", follows: "with every briefing — which knowledge fits which todo (new and changed todos only)" }],
};
