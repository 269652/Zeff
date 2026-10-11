import { t } from "@/lib/i18n/server";
import { setStepMinutes, stepMinutes } from "@/lib/sync/intervals";
import { MINUTE_CHOICES, type PluginSyncSettings } from "../sync-settings";

/** Google Keep's part of the Sync settings: its own sync. */
export const syncSettings: PluginSyncSettings = {
  intervals: [
    {
      key: "keep",
      label: "Google Keep",
      get what() {
        return t("Your notes and lists — Keep is opened in a new tab, what it loads is taken over, then the tab is closed again. Nothing changes in Keep.");
      },
      get: () => stepMinutes("keep"),
      set: (m) => setStepMinutes("keep", m),
      choices: MINUTE_CHOICES,
      get window() {
        return t("while the automation Chrome is running");
      },
    },
  ],
  // Its extensions' steps (shown while they're on): with each Ticket-Lage.
  follows: [
    {
      key: "notetodos",
      get label() {
        return t("Note review");
      },
      get follows() {
        return t("with every briefing — todos from new and changed notes");
      },
    },
    {
      key: "noterelations",
      get label() {
        return t("Note matching");
      },
      get follows() {
        return t("with every briefing — which notes belong to which todo");
      },
    },
  ],
};
