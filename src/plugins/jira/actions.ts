/** The Jira plugin's actions: a status, an assignee, a comment, a new ticket — through Zeff's Jira connection. Client-safe. */
import { action, str, ticketKey } from "../actions/types";

export const JIRA_ACTIONS = [
  action({
    type: "jira-transition",
    plugin: "jira",
    label: "Jira-Status ändern",
    verb: "Move",
    offer: {
      when: "Das Ticket soll in einen anderen Status (z. B. nach der Umsetzung auf Testing).",
      fields: { ticket: "der Ticket-Key", to: "der Name eines der möglichen Übergänge des Tickets, genau so geschrieben" },
      example: { type: "jira-transition", ticket: "PROJ-415", to: "Testing" },
    },
    clean: (o, c) => (str(o.to) ? { type: "jira-transition", ticket: ticketKey(o.ticket, c.ticket), to: str(o.to) } : null),
    title: (op) => `${op.ticket} → ${op.to}`,
    note: (op) => ({ heading: "Jira-Status ändern", detail: `${op.ticket} → ${op.to}`, body: null }),
  }),
  action({
    type: "jira-assign",
    plugin: "jira",
    label: "Jira-Ticket zuweisen",
    verb: "Assign",
    offer: {
      when: "Das Ticket soll jemand anderem gehören (z. B. dem Tester).",
      fields: { ticket: "der Ticket-Key", assignee: "der Jira-Benutzername (bei den Beteiligten in Klammern hinter dem Namen)" },
      example: { type: "jira-assign", ticket: "PROJ-415", assignee: "clorenz" },
    },
    clean: (o, c) => (str(o.assignee) ? { type: "jira-assign", ticket: ticketKey(o.ticket, c.ticket), assignee: str(o.assignee) } : null),
    title: (op) => `${op.ticket} zuweisen: ${op.assignee}`,
    note: (op) => ({ heading: "Jira-Ticket zuweisen", detail: `${op.ticket} → ${op.assignee}`, body: null }),
  }),
  action({
    type: "jira-comment",
    plugin: "jira",
    label: "Jira-Kommentar posten",
    verb: "Comment",
    comms: true,
    offer: {
      when: "Ein Kommentar im Ticket — Stand, Antwort auf eine Rückfrage, Bitte um Test.",
      fields: { ticket: "der Ticket-Key", body: "der fertige Kommentar (Jira-Wiki-Markup)" },
      example: { type: "jira-comment", ticket: "PROJ-415", body: "Der Fix ist auf feature/PROJ-415-… — bitte erneut testen." },
    },
    clean: (o, c) => (str(o.body) ? { type: "jira-comment", ticket: ticketKey(o.ticket, c.ticket), body: str(o.body).slice(0, 8000) } : null),
    title: (op) => `Kommentar auf ${op.ticket}`,
    note: (op) => ({ heading: `Kommentar auf ${op.ticket}`, detail: null, body: op.body }),
  }),
  action({
    type: "jira-create",
    plugin: "jira",
    label: "Jira-Ticket anlegen",
    verb: "Create",
    offer: {
      when: "Ein neues Ticket ist nötig (ein Thema wird ausgelagert, eine Folgearbeit, ein gefundenes Problem) — mit fertigem Titel und vollständiger Beschreibung, im Projekt des Tickets und mit ihm verknüpft.",
      fields: {
        ticket: "das Ticket, aus dem es kommt (damit wird es verknüpft; sein Projekt ist das des neuen)",
        summary: "der Titel des neuen Tickets",
        issueType: "Task, Bug oder Story",
        body: "die Beschreibung in Markdown: Hintergrund (mit Verweis aufs Ticket), was genau zu tun ist, Akzeptanzkriterien als Liste",
      },
      example: {
        type: "jira-create",
        ticket: "PROJ-415",
        summary: "Nicht unterstützte Video-URLs in der VideoHub-Migration behandeln",
        issueType: "Task",
        body: "Aus PROJ-415: Die VideoHub-Migration überspringt Video-URLs, die VideoHub nicht importieren kann.\n\n## Zu tun\n- Anzahl und Art der betroffenen URLs ermitteln\n- klären, ob die Seiten noch aktiv sind\n\n## Akzeptanzkriterien\n- Liste der URLs mit Seite und Status liegt vor",
      },
    },
    clean: (o, c) =>
      str(o.summary) && str(o.body)
        ? { type: "jira-create", ticket: ticketKey(o.ticket, c.ticket), summary: str(o.summary).slice(0, 250), issueType: str(o.issueType) || str(o.issue_type) || "Task", body: str(o.body).slice(0, 20000) }
        : null,
    title: (op) => `Ticket anlegen: ${op.summary}`,
    note: (op) => ({ heading: `Jira-Ticket anlegen (${op.ticket.split("-")[0]}, ${op.issueType})`, detail: `„${op.summary}“ — verknüpft mit ${op.ticket}`, body: op.body }),
  }),
];
