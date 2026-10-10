import { MAIL_FOLLOWERS } from "@/lib/mail/sync-settings";
import { setStepMinutes, stepMinutes } from "@/lib/sync/intervals";
import { MINUTE_CHOICES, type PluginSyncSettings } from "../sync-settings";

/** WhatsApp's part of the Sync settings: its own sync, and the Durchsicht its messages go through. */
export const syncSettings: PluginSyncSettings = {
  intervals: [
    {
      key: "whatsapp",
      label: "WhatsApp",
      what: "Die letzte Nachricht jedes Chats — aus WhatsApp Webs Chatliste, kein Chat geöffnet. Je öfter, desto weniger Nachrichten gehen zwischen zwei Syncs unter.",
      get: () => stepMinutes("whatsapp"),
      set: (m) => setStepMinutes("whatsapp", m),
      choices: MINUTE_CHOICES,
      window: "solange der Automations-Chrome läuft",
    },
  ],
  follows: MAIL_FOLLOWERS,
};
