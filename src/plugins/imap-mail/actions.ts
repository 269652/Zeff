/**
 * The mail accounts' action (IMAP / POP3): a mail sent over the account's SMTP server. Sent only by your click on the reply's (or a new mail's) "Send"
 * — never by a todo's "Run", a worker or an agent: those get the mail as a draft in your mail program (a mailto: link) to send
 * yourself. Client-safe.
 */
import { action, EN, str } from "../actions/types";

/** The operation types this plugin brings (an entry per `type`); the core's TodoOp is the union of all plugins'. */
declare module "@/lib/todos/shared" {
  interface TodoOpMap {
    /** A mail through the IMAP mailbox's SMTP server — addresses separated by "," or ";". */
    "imap-send": { to: string; subject: string; body: string; /** The account a new mail goes from (a reply: the conversation's). */ account?: string };
  }
}

const enc = encodeURIComponent;

export const IMAP_ACTIONS = [
  action({
    type: "imap-send",
    plugin: "imap-mail",
    label: "Write mail (E-Mail)",
    verb: "Mail",
    comms: true,
    offer: {
      when: "Eine Antwort per Mail auf eine Mail eines E-Mail-Kontos (IMAP / POP3; Unterhaltung imap:…) oder eine neue Mail von dort. Der Text fertig formuliert in Sprache und Ton der Mail; ohne Platzhalter.",
      fields: {
        to: "die E-Mail-Adresse des Empfängers, wie sie bei der Mail steht — leer, wenn sie unbekannt ist",
        subject: "der Betreff (bei einer Antwort: „AW: “ und der Betreff der Mail)",
        body: "der fertige Text mit Anrede und Gruß",
      },
      example: { type: "imap-send", to: "anna@example.de", subject: "AW: Sonntag", body: "Liebe Anna,\n\ngerne, ich komme um drei.\n\nHerzliche Grüße" },
    },
    clean: (o) => (str(o.body) ? { type: "imap-send", to: str(o.to).slice(0, 300), subject: str(o.subject).slice(0, 300), body: str(o.body).slice(0, 8000), ...(/^m\d+$/.test(str(o.account)) ? { account: str(o.account) } : {}) } : null),
    title: (op, t = EN) => `${op.to ? t("Mail to {to}", { to: op.to }) : t("Mail")}${op.subject ? ` “${op.subject.slice(0, 60)}”` : ""}`,
    note: (op, t = EN) => ({ heading: op.to ? t("Mail to {to}", { to: op.to }) : t("Mail"), detail: op.subject || null, body: op.body }),
    // Outside the reply's own "Send": your mail program's window, filled in — sent by you.
    href: (op) => `mailto:${enc(op.to.replace(/;/g, ","))}?subject=${enc(op.subject)}&body=${enc(op.body)}`,
  }),
];
