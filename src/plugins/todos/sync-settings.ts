import { getBoardSettings, updateBoardSettings } from "@/lib/boards/store";
import type { PluginSyncSettings } from "../sync-settings";

/** Todos' part of the Sync settings: the Ticket-Lage run (the Auswertung) and the morning's Recap. */
export const syncSettings: PluginSyncSettings = {
  intervals: [
    {
      key: "boards",
      label: "Ticket-Lage (Auswertung)",
      what: "Deine Tickets durch die KI: was passiert ist, was zu tun ist — danach die Mail- und WhatsApp-Durchsicht, die Mail-Zuordnung und die Auto-Aktionen.",
      get: () => getBoardSettings().autoMinutes,
      set: (m) => updateBoardSettings({ autoMinutes: m }),
      choices: [0, 15, 30, 60, 120, 240, 480, 1440],
      window: "an Werktagen, 8–19 Uhr",
    },
  ],
  follows: [{ key: "recap", label: "Recap", follows: "jeden Werktagmorgen — der Rückblick auf den letzten Werktag" }],
};
