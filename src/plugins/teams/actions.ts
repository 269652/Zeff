/** The Teams plugin's action: a 1:1 message, sent through Teams Web in the automation Chrome. Client-safe. */
import { action, EN, str } from "../actions/types";

export const TEAMS_ACTIONS = [
  action({
    type: "teams-message",
    plugin: "teams",
    label: "Send Teams message",
    verb: "Send",
    comms: true,
    offer: {
      when: "Eine kurze Frage, Bitte, Absprache oder ein Nachhaken bei einer Person per Teams-Chat (z. B. eine Rückfrage, die seit über einem Arbeitstag offen ist, „wann hast du Zeit für …“, eine Info an den Tester) — mit Bezug aufs Ticket und dem, was du brauchst. Nicht, wenn die Person laut Daten abwesend ist oder schon geantwortet hat.",
      fields: {
        to: "der volle Anzeigename der Person, wie bei den Beteiligten (ohne Benutzernamen), z. B. Christopher Ressl",
        body: "die fertige Nachricht (Klartext, Du-Form, 1–3 Sätze, mit Ticket-Key)",
      },
      example: {
        type: "teams-message",
        to: "Christopher Ressl",
        body: "Hi Christopher, kurze Nachfrage zu PROJ-321: soll die Navigation-Story ohne das Refinement gebaut werden oder in ein eigenes Ticket? Dann kann ich weitermachen.",
      },
    },
    clean: (o) => (str(o.to) && str(o.body) ? { type: "teams-message", to: str(o.to).slice(0, 120), body: str(o.body).slice(0, 4000) } : null),
    title: (op, t = EN) => t("Teams message to {to}", { to: op.to }),
    note: (op, t = EN) => ({ heading: t("Teams message to {to}", { to: op.to }), detail: null, body: op.body }),
  }),
];
