/**
 * The Outlook plugins' actions — in your browser: Outlook Web opens with a mail draft (the mail
 * plugin) or an appointment (the calendar plugin) filled in; you check it and send it yourself.
 * Client-safe.
 */
import { formatDate, formatTime } from "@/lib/format";
import { action, str } from "../actions/types";

const OWA = "https://outlook.office.com";
const q = (params: Record<string, string>) =>
  Object.entries(params)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
/** Addresses as Outlook takes them: separated by ";" (names without an address stay out of the field). */
const addresses = (v: string) =>
  v
    .split(/[;,]/)
    .map((x) => x.trim())
    .filter((x) => /@/.test(x))
    .join(";");
/** "2026-10-13 10:00" / "2026-10-13T10:00" → local "2026-10-13T10:00:00"; plus minutes. */
const localIso = (v: string, plusMinutes = 0) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(v.trim());
  if (!m) return "";
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5] + plusMinutes);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
};

export const OUTLOOK_MAIL_ACTIONS = [
  action({
    type: "mail-compose",
    plugin: "outlook-mail",
    label: "Mail draft in Outlook",
    verb: "Mail",
    comms: true,
    offer: {
      when: "Eine Antwort oder Nachricht per Mail — an jemanden außerhalb von Teams und Jira (Kunde, Ansprechpartner aus einer Mail), oder als Antwort auf eine Mail. Outlook öffnet sich mit dem fertigen Entwurf; der Nutzer sendet ihn selbst.",
      fields: {
        to: "die Mail-Adresse(n), mit ; getrennt — nur Adressen aus dem Kontext (Absender der Mails, Adressbuch)",
        subject: "der Betreff (bei einer Antwort „AW: “ + Betreff der Mail)",
        body: "der fertige Text (Klartext, mit Anrede, kurz, mit Gruß)",
      },
      example: { type: "mail-compose", to: "anna.schmidt@example.org", subject: "AW: Freigabe Startseite", body: "Hallo Frau Schmidt,\n\ndie Änderung ist auf Test — können Sie sie bis Freitag freigeben?\n\nViele Grüße" },
    },
    clean: (o) => (str(o.subject) && str(o.body) ? { type: "mail-compose", to: addresses(str(o.to)), subject: str(o.subject).slice(0, 250), body: str(o.body).slice(0, 8000) } : null),
    title: (op) => `Mail${op.to ? ` to ${op.to.split(";")[0]}` : ""}: ${op.subject}`,
    note: (op) => ({ heading: `Mail draft${op.to ? ` to ${op.to.replace(/;/g, ", ")}` : ""}`, detail: `Subject: ${op.subject}`, body: op.body }),
    href: (op) => `${OWA}/mail/deeplink/compose?${q({ to: op.to, subject: op.subject, body: op.body })}`,
  }),
];

export const OUTLOOK_CALENDAR_ACTIONS = [
  action({
    type: "calendar-event",
    plugin: "outlook-calendar",
    label: "Meeting in Outlook",
    verb: "Meeting",
    offer: {
      when: "Ein Termin, der vereinbart oder vorgeschlagen werden soll (eine gemeinsame Prüfung, eine Abstimmung, ein Deployment-Fenster) oder den du dir selbst blockst. Outlook öffnet sich mit dem fertigen Termin; der Nutzer prüft und sendet ihn.",
      fields: {
        subject: "der Titel des Termins (mit Ticket-Key)",
        start: "Beginn als JJJJ-MM-TT HH:MM (ein Werktag, 9–17 Uhr, nicht in der Vergangenheit)",
        minutes: "die Dauer in Minuten (15–120)",
        attendees: "Mail-Adressen der Teilnehmer, mit ; getrennt (leer: nur für dich)",
        body: "worum es geht, 1–3 Sätze",
      },
      example: { type: "calendar-event", subject: "PROJ-415 VideoHub-Migration gemeinsam prüfen", start: "2026-10-13 14:00", minutes: "30", attendees: "christopher.ressl@example.org", body: "Wir gehen die migrierten Video-Einträge auf Test durch." },
    },
    clean: (o) =>
      str(o.subject) && localIso(str(o.start))
        ? {
            type: "calendar-event",
            subject: str(o.subject).slice(0, 250),
            start: localIso(str(o.start)).slice(0, 16),
            minutes: Math.min(480, Math.max(15, Math.round(Number(str(o.minutes)) || 30))),
            attendees: addresses(str(o.attendees)),
            body: str(o.body).slice(0, 4000),
          }
        : null,
    title: (op) => `Meeting: ${op.subject}`,
    note: (op) => ({
      heading: `Meeting in Outlook${op.attendees ? ` with ${op.attendees.replace(/;/g, ", ")}` : ""}`,
      detail: `${formatDate(op.start)}, ${formatTime(op.start)} · ${op.minutes} min · “${op.subject}”`,
      body: op.body || null,
    }),
    href: (op) => `${OWA}/calendar/deeplink/compose?${q({ subject: op.subject, body: op.body, startdt: localIso(op.start), enddt: localIso(op.start, op.minutes), to: op.attendees })}`,
  }),
];
