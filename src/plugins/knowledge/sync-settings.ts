import type { PluginSyncSettings } from "../sync-settings";

/** Knowledge's part of the Sync settings: the Wissens-Zuordnung runs with the Ticket-Lage. */
export const syncSettings: PluginSyncSettings = {
  follows: [{ key: "knowledgerel", label: "Wissens-Zuordnung", follows: "mit jeder Ticket-Lage — welches Wissen zu welchem Todo passt (nur neue und geänderte Todos)" }],
};
