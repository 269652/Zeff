/**
 * WhatsApp's action for Auto-Aktionen (its extension "Nachricht senden"): a message to a chat,
 * sent through WhatsApp Web in the automation Chrome — on your click, never by itself. Client-safe.
 */
import { action, str } from "../actions/types";

export const WHATSAPP_ACTIONS = [
  action({
    type: "whatsapp-message",
    plugin: "whatsapp",
    label: "WhatsApp-Nachricht senden",
    verb: "Senden",
    comms: true,
    offer: {
      when: "Eine Antwort oder Nachricht an eine Person oder Gruppe per WhatsApp — wenn das Todo aus einem WhatsApp-Chat kommt (Ordner WhatsApp) oder jemanden betrifft, mit dem ich per WhatsApp schreibe: zusagen, absagen, eine Uhrzeit vorschlagen, nachfragen, sich melden. Sprache, Anrede und Ton wie im Chat; kurz und natürlich, wie ich schreibe. Nur, wenn die Antwort nicht schon im Chat steht.",
      fields: {
        chat: "der Name des Chats genau wie im WhatsApp-Verlauf (der Betreff der Nachrichten, z. B. Natha oder Elmar Schöttner)",
        body: "die fertige Nachricht (Klartext, 1–3 Sätze, ohne Platzhalter)",
      },
      example: { type: "whatsapp-message", chat: "Natha", body: "Hey, morgen um 15 Uhr passt mir gut für die Flaschen — ich bring die große Tüte mit 😊" },
    },
    clean: (o) => (str(o.chat) && str(o.body) ? { type: "whatsapp-message", chat: str(o.chat).slice(0, 120), body: str(o.body).slice(0, 4000) } : null),
    title: (op) => `WhatsApp an ${op.chat}`,
    note: (op) => ({ heading: `WhatsApp-Nachricht an ${op.chat}`, detail: null, body: op.body }),
  }),
];
