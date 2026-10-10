import { setStepMinutes, stepMinutes } from "@/lib/sync/intervals";
import { MINUTE_CHOICES, type PluginSyncSettings } from "../sync-settings";

/** Google Keep's part of the Sync settings: its own sync. */
export const syncSettings: PluginSyncSettings = {
  intervals: [
    {
      key: "keep",
      label: "Google Keep",
      what: "Deine Notizen und Listen — Keep wird in einem neuen Tab geöffnet, was es lädt, wird übernommen, der Tab wieder geschlossen. In Keep ändert sich nichts.",
      get: () => stepMinutes("keep"),
      set: (m) => setStepMinutes("keep", m),
      choices: MINUTE_CHOICES,
      window: "solange der Automations-Chrome läuft",
    },
  ],
  // Its extensions' steps (shown while they're on): with each Ticket-Lage.
  follows: [
    { key: "notetodos", label: "Notiz-Durchsicht", follows: "mit jeder Ticket-Lage (Auswertung) — Todos aus neuen und geänderten Notizen" },
    { key: "noterelations", label: "Notiz-Zuordnung", follows: "mit jeder Ticket-Lage — welche Notizen zu welchem Todo gehören" },
  ],
};
