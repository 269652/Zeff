import { t } from "@/lib/i18n/server";
import { getBoardSettings, updateBoardSettings } from "@/lib/runs/store";
import type { PluginSyncSettings } from "../sync-settings";

/** Todos' part of the Sync settings: the Ticket-Lage run (the Auswertung) and the morning's Recap. */
export const syncSettings: PluginSyncSettings = {
  intervals: [
    {
      key: "boards",
      get label() {
        return t("Briefing");
      },
      get what() {
        return t("Your tickets read by the AI: what happened, what to do — then the mail and WhatsApp review, mail matching and the auto actions.");
      },
      get: () => getBoardSettings().autoMinutes,
      set: (m) => updateBoardSettings({ autoMinutes: m }),
      choices: [0, 15, 30, 60, 120, 240, 480, 1440],
      get window() {
        return t("on weekdays, 8:00–19:00");
      },
    },
  ],
  follows: [
    {
      key: "recap",
      get label() {
        return t("Recap");
      },
      get follows() {
        return t("every weekday morning — the look back at the last working day");
      },
    },
  ],
};
