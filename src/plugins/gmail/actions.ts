/**
 * Gmail's action for Auto-Aktionen (its extension "Mail schreiben"): a mail drafted in Gmail —
 * the click opens Gmail's compose window, filled in, in your browser; you check and send it
 * yourself. With Gmail's write access (Connections page) the todo also shows "Send" and "Save as
 * draft in Gmail": your click on one runs it through Gmail's API (gmail/run.ts) — never the
 * todo's "Run", a worker or an agent. Client-safe.
 */
import { action, EN, str } from "../actions/types";

/** The operation types this plugin brings (an entry per `type`); the core's TodoOp is the union of all plugins'. */
declare module "@/lib/boards/shared" {
  interface TodoOpMap {
  "gmail-compose": { to: string; subject: string; body: string };
  }
}

const enc = encodeURIComponent;

export const GMAIL_ACTIONS = [
  action({
    type: "gmail-compose",
    plugin: "gmail",
    label: "Write mail (Gmail)",
    verb: "Open in Gmail",
    comms: true,
    offer: {
      when: "Eine Mail aus Gmail heraus: auf eine Mail antworten (Ordner Gmail …), etwas anfragen, einreichen oder absagen — wenn das Todo aus einer Gmail-Mail kommt oder eine Mail verlangt. Der Text fertig formuliert in Sprache und Ton der Mail; ohne Platzhalter.",
      fields: {
        to: "die E-Mail-Adresse des Empfängers, wie sie bei der Mail steht — leer, wenn sie unbekannt ist",
        subject: "der Betreff (bei einer Antwort: „Re: “ und der Betreff der Mail)",
        body: "der fertige Text mit Anrede und Gruß",
      },
      example: { type: "gmail-compose", to: "kundenservice@example.com", subject: "Re: Ihre Angaben", body: "Hallo,\n\nanbei die gewünschten Angaben …\n\nViele Grüße\nMax" },
    },
    clean: (o) =>
      str(o.body) ? { type: "gmail-compose", to: str(o.to).slice(0, 300), subject: str(o.subject).slice(0, 300), body: str(o.body).slice(0, 8000) } : null,
    title: (op, t = EN) => `${op.to ? t("Mail to {to}", { to: op.to }) : t("Mail")}${op.subject ? ` “${op.subject.slice(0, 60)}”` : ""}`,
    note: (op, t = EN) => ({ heading: op.to ? t("Mail to {to}", { to: op.to }) : t("Mail"), detail: op.subject || null, body: op.body }),
    // Gmail's compose window, filled in (the first signed-in account) — sent by you.
    href: (op) => `https://mail.google.com/mail/u/0/?view=cm&fs=1&to=${enc(op.to)}&su=${enc(op.subject)}&body=${enc(op.body)}`,
  }),
];
