import type { PluginSyncSettings } from "../sync-settings";

/** Auto-Aktionen's part of the Sync settings: it runs with the Ticket-Lage (its last step). */
export const syncSettings: PluginSyncSettings = {
  follows: [{ key: "autoactions", label: "Auto actions", follows: "with every briefing (its last step) — ready-made actions for the todos without a button" }],
};
