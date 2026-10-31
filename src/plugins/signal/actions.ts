/**
 * Signal's action for Auto-Aktionen (its extension "Nachricht senden"): a message to a chat, sent
 * through Signal Desktop — on your click, never by itself. Client-safe.
 */
import { action, EN, str } from "../actions/types";

/** The operation types this plugin brings (an entry per `type`); the core's TodoOp is the union of all plugins'. */
declare module "@/lib/todos/shared" {
  interface TodoOpMap {
  "signal-message": { chat: string; body: string };
  }
}

export const SIGNAL_ACTIONS = [
  action({
    type: "signal-message",
    plugin: "signal",
    label: "Send Signal message",
    verb: "Send",
    comms: true,
    offer: {
      when: "Eine Antwort oder Nachricht an eine Person oder Gruppe per Signal — wenn das Todo aus einem Signal-Chat kommt (Ordner Signal) oder jemanden betrifft, mit dem ich per Signal schreibe: zusagen, absagen, eine Uhrzeit vorschlagen, nachfragen, sich melden. Sprache, Anrede und Ton wie im Chat; kurz und natürlich, wie ich schreibe. Nur, wenn die Antwort nicht schon im Chat steht.",
      fields: {
        chat: "der Name des Chats genau wie im Signal-Verlauf (der Betreff der Nachrichten, z. B. Natha oder Elmar Schöttner)",
        body: "die fertige Nachricht (Klartext, 1–3 Sätze, ohne Platzhalter)",
      },
      example: { type: "signal-message", chat: "Natha", body: "Hey, morgen um 15 Uhr passt mir gut — ich bring die große Tüte mit 😊" },
    },
    clean: (o) => (str(o.chat) && str(o.body) ? { type: "signal-message", chat: str(o.chat).slice(0, 120), body: str(o.body).slice(0, 4000) } : null),
    title: (op, t = EN) => t("Signal to {chat}", { chat: op.chat }),
    note: (op, t = EN) => ({ heading: t("Signal message to {chat}", { chat: op.chat }), detail: null, body: op.body }),
  }),
];
