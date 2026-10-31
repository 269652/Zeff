import type { T } from "@/lib/i18n/shared";
import { localDay as dayOf } from "@/lib/dates";

/**
 * What the timeline's views share (the Timeline plugin): a sign and a name per kind of event, the kinds and sources to filter by,
 * events grouped by day. Client-safe.
 */

/** The kinds as the filters offer them (a prefix: "todo" is every todo event). */
export const KIND_GROUPS = ["mail", "message", "ticket", "comment", "mr", "meeting", "time", "todo", "row", "page", "note", "action", "payment", "document"] as const;
export const SOURCES = ["mail", "whatsapp", "signal", "teams", "jira", "gitlab", "calendar", "time", "todos", "workspace", "pages", "keep", "actions", "bank", "documents"] as const;

/** The actor of what you did yourself (a mail you sent, a page you edited, an action you clicked). */
export const ME_REF = "me:you";

const ICON: Record<string, string> = {
  mail: "✉️",
  message: "💬",
  "ticket.created": "🎫",
  "ticket.status": "🔀",
  "ticket.updated": "🎫",
  comment: "🗨️",
  "mr.opened": "🔧",
  "mr.merged": "✅",
  "mr.closed": "⛔",
  "mr.comment": "🗨️",
  meeting: "📅",
  time: "⏱️",
  "todo.created": "☐",
  "todo.done": "☑️",
  "todo.dismissed": "✖️",
  "todo.reopened": "↩️",
  "todo.merged": "🔗",
  "row.added": "➕",
  "row.changed": "✏️",
  "page.added": "📄",
  "page.changed": "📝",
  "mail.sent": "📤",
  note: "🗒️",
  action: "▶️",
  payment: "💶",
  document: "📄",
};

/** A kind's sign (its group's when the kind itself has none). */
export const kindIcon = (kind: string): string => ICON[kind] ?? ICON[kind.split(".")[0]] ?? "•";

/** A kind's name, as the list shows it. */
export function kindLabel(t: T, kind: string): string {
  const names: Record<string, string> = {
    mail: t("Mail"),
    message: t("Message"),
    "ticket.created": t("Ticket opened"),
    "ticket.status": t("Status changed"),
    "ticket.updated": t("Ticket updated"),
    comment: t("Comment"),
    "mr.opened": t("Merge request opened"),
    "mr.merged": t("Merge request merged"),
    "mr.closed": t("Merge request closed"),
    "mr.comment": t("Merge request comment"),
    meeting: t("Appointment"),
    time: t("Time booked"),
    "todo.created": t("Todo made"),
    "todo.done": t("Todo done"),
    "todo.dismissed": t("Todo dropped"),
    "todo.reopened": t("Todo opened again"),
    "todo.merged": t("Todo merged"),
    "row.added": t("Row added"),
    "row.changed": t("Row changed"),
    "page.added": t("Page added"),
    "page.changed": t("Page changed"),
    "mail.sent": t("Mail sent"),
    note: t("Note"),
    action: t("Action"),
    payment: t("Payment"),
    document: t("Document"),
  };
  return names[kind] ?? kind;
}

/** A kind group's name for the filters. */
export function kindGroupLabel(t: T, group: string): string {
  const names: Record<string, string> = { mail: t("Mails"), message: t("Messages"), ticket: t("Tickets"), comment: t("Comments"), mr: t("Merge requests"), meeting: t("Appointments"), time: t("Time"), todo: t("Todos"), row: t("Workspace rows"), page: t("Pages"), note: t("Notes"), action: t("Actions"), payment: t("Payments"), document: t("Documents") };
  return names[group] ?? group;
}

/** A source's name for the filters. */
export function sourceLabel(t: T, source: string): string {
  const names: Record<string, string> = { mail: t("Mail"), whatsapp: "WhatsApp", signal: "Signal", teams: "Teams", jira: "Jira", gitlab: "GitLab", calendar: t("Calendar"), time: t("Time entries"), todos: t("Todos"), workspace: t("Workspace"), pages: t("Pages"), keep: "Keep", actions: t("Actions"), bank: t("Bank"), documents: t("Documents") };
  return names[source] ?? source;
}

/** The local day of an ISO time (YYYY-MM-DD). */
export function localDay(iso: string): string {
  return dayOf(new Date(iso));
}

/** Events by their local day, in the order given (newest first); each day once. */
export function byDay<E extends { at: string }>(events: E[]): { day: string; events: E[] }[] {
  const out: { day: string; events: E[] }[] = [];
  for (const e of events) {
    const day = localDay(e.at);
    const last = out[out.length - 1];
    if (last?.day === day) last.events.push(e);
    else out.push({ day, events: [e] });
  }
  return out;
}

/** Where the "since your last visit" line goes: the index of the first event you had seen (-1: none new, or all new). */
export function seenIndex<E extends { at: string }>(events: E[], lastSeen: string | null): number {
  if (!lastSeen) return -1;
  const i = events.findIndex((e) => e.at <= lastSeen);
  return i <= 0 ? -1 : i;
}
