/**
 * Gmail's action for Auto-Aktionen (its extension "Mail schreiben"): a mail drafted in Gmail —
 * the click opens Gmail's compose window, filled in, in your browser; you check and send it
 * yourself. Client-safe.
 */
import { action, str } from "../actions/types";

const enc = encodeURIComponent;

export const GMAIL_ACTIONS = [
  action({
    type: "gmail-compose",
    plugin: "gmail",
    label: "Mail schreiben (Gmail)",
    verb: "In Gmail öffnen",
    comms: true,
    offer: {
      when: "Eine Mail aus Gmail heraus: auf eine Mail antworten (Ordner Gmail …), etwas anfragen, einreichen oder absagen — wenn das Todo aus einer Gmail-Mail kommt oder eine Mail verlangt. Der Text fertig formuliert in Sprache und Ton der Mail; ohne Platzhalter.",
      fields: {
        to: "die E-Mail-Adresse des Empfängers, wie sie bei der Mail steht — leer, wenn sie unbekannt ist",
        subject: "der Betreff (bei einer Antwort: „Re: “ und der Betreff der Mail)",
        body: "der fertige Text mit Anrede und Gruß",
      },
      example: { type: "gmail-compose", to: "kundenservice@example.com", subject: "Re: Ihre Angaben", body: "Hallo,\n\nanbei die gewünschten Angaben …\n\nViele Grüße\nMoritz" },
    },
    clean: (o) =>
      str(o.body) ? { type: "gmail-compose", to: str(o.to).slice(0, 300), subject: str(o.subject).slice(0, 300), body: str(o.body).slice(0, 8000) } : null,
    title: (op) => `Mail${op.to ? ` an ${op.to}` : ""}${op.subject ? ` „${op.subject.slice(0, 60)}“` : ""}`,
    note: (op) => ({ heading: `Mail${op.to ? ` an ${op.to}` : ""}`, detail: op.subject || null, body: op.body }),
    // Gmail's compose window, filled in (the first signed-in account) — sent by you.
    href: (op) => `https://mail.google.com/mail/u/0/?view=cm&fs=1&to=${enc(op.to)}&su=${enc(op.subject)}&body=${enc(op.body)}`,
  }),
];
