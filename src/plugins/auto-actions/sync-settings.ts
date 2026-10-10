import type { PluginSyncSettings } from "../sync-settings";

/** Auto-Aktionen's part of the Sync settings: it runs with the Ticket-Lage (its last step). */
export const syncSettings: PluginSyncSettings = {
  follows: [{ key: "autoactions", label: "Auto-Aktionen", follows: "mit jeder Ticket-Lage (ihr letzter Schritt) — fertige Aktionen für die Todos ohne Knopf" }],
};
