/**
 * Linked sources: a context item's links that point at a synced Teams message, a GitLab item —
 * or a board todo (zeff:todo:<id>), work done that can back an entry. Client-safe (types and
 * wording only).
 */
import type { JiraCommentView, TodoSource, TodoView } from "./boards/shared";
import { gitlabDone, gitlabHeadline, type GitlabItemView } from "./gitlab/shared";
import type { TeamsMessageView } from "./teams/shared";
import { mailSender, type MailView } from "./mail/shared";
import { noteHeadline } from "@/plugins/keep/shared";

/** A Jira ticket, as a source: what it's called, where it stands, its link. */
export type JiraTicketBrief = { key: string; summary: string; status: string; assignee: string | null; description: string | null; url: string };

/** An agent's or worker's run on a todo (Code tab), as evidence: who, how long, what it reported. */
export type WorkRunBrief = {
  id: number;
  ref: string;
  /** The agent ("GitHub Copilot", "Claude Code") or the worker's model. */
  agent: string;
  todoId: number | null;
  ticket: string;
  status: string;
  outcome: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  minutes: number | null;
  /** Its one line for the booking, and its report. */
  entryLine: string | null;
  summary: string | null;
  branch: string | null;
};

/** A time record on a todo (an agent's report of a stretch of work), as evidence of a booking. */
export type TimeBrief = {
  id: number;
  ref: string;
  todoId: number;
  todo: string;
  ticket: string;
  minutes: number;
  note: string;
  by: string;
  at: string;
};

/** A synced Teams message, a GitLab item, a Jira comment or ticket, or a board todo a link points at. */
export type Entity =
  | { source: "teams"; teams: TeamsMessageView }
  | { source: "gitlab"; gitlab: GitlabItemView }
  | { source: "jira-comment"; comment: JiraCommentView }
  | { source: "jira"; ticket: JiraTicketBrief }
  /** A mail from your inbox (as Outlook's list shows it). */
  | { source: "mail"; mail: MailView }
  /** A todo, with what it came from (when known). */
  | { source: "todo"; todo: TodoView; from?: TodoSource[] }
  /** A run on a todo (an agent's through the MCP, or a Zeff worker's) — what it did and how long. */
  | { source: "work"; run: WorkRunBrief }
  /** A stretch of time reported on a todo — what an entry's hours add up from. */
  | { source: "time"; time: TimeBrief };

/**
 * Anything these helpers describe: a context item's linked source (Entity) or what a todo came from
 * (TodoSource) — the same messages and items, so one set of helpers serves both.
 */
export type Sourced = Entity | TodoSource;

/** Links (as written) → the synced message / item / todo each points at. */
export type EntityMap = Record<string, Entity>;

/** A board todo's link (what a context item stores for it). */
export const todoLink = (id: number) => `zeff:todo:${id}`;
/** A run's link (what a context item stores for it). */
export const workLink = (id: number) => `zeff:work:${id}`;
/** A time record's link (what a context item stores for it). */
export const timeLink = (id: number) => `zeff:time:${id}`;
/** The time record a link points at, or null. */
export const timeIdOfLink = (url: string) => {
  const m = /^zeff:time:(\d+)$/.exec(url.trim());
  return m ? Number(m[1]) : null;
};
/** The run a link points at, or null. */
export const workIdOfLink = (url: string) => {
  const m = /^zeff:work:(\d+)$/.exec(url.trim());
  return m ? Number(m[1]) : null;
};

/** The todo a link points at, or null. */
export const todoIdOfLink = (url: string) => {
  const m = /^zeff:todo:(\d+)$/.exec(url.trim());
  return m ? Number(m[1]) : null;
};

/** A Jira link's ticket — and comment, when it points at one (…/browse/PROJ-339?focusedCommentId=123, #comment-123). */
export function jiraLinkOf(url: string): { ticket: string; commentId: string | null } | null {
  const m = /^https?:\/\/[^?#\s]*?\/browse\/([A-Za-z][A-Za-z0-9]+-\d+)(?!\d)/.exec(url.trim());
  if (!m) return null;
  const c = /[?&]focusedCommentId=(\d+)|#comment-(\d+)/.exec(url);
  return { ticket: m[1].toUpperCase(), commentId: c ? (c[1] ?? c[2]) : null };
}

/** SQLite's "YYYY-MM-DD HH:MM:SS" (UTC) or ISO → ISO. */
const iso = (t: string) => (/^\d{4}-\d{2}-\d{2} /.test(t) ? `${t.replace(" ", "T")}Z` : t);

/** Which message / item / todo it is — the same for every link to it, however it's written. */
export const entityKey = (e: Sourced) =>
  e.source === "teams"
    ? `teams:${e.teams.key}`
    : e.source === "gitlab"
      ? `gitlab:${e.gitlab.key}`
      : e.source === "jira-comment"
        ? `jira-comment:${e.comment.id}`
        : e.source === "mail"
          ? `mail:${e.mail.key}`
          : e.source === "jira"
            ? `jira:${e.ticket.key}`
            : e.source === "work"
              ? `work:${e.run.id}`
              : e.source === "time"
                ? `time:${e.time.id}`
                : e.source === "keep"
                ? e.note.ref
                : e.source === "fact"
                  ? e.fact.ref
                  : e.source === "document"
                    ? e.doc.ref
                    : `todo:${e.todo.id}`;

/** Who wrote it and when (ISO). A todo: nobody's words — when it was done (else found). */
export function entityWhoWhen(e: Sourced): { author: string | null; at: string | null } {
  if (e.source === "teams") return { author: e.teams.senderName, at: e.teams.sentAt };
  if (e.source === "mail") return { author: mailSender(e.mail), at: e.mail.receivedAt };
  if (e.source === "todo") return { author: null, at: iso(e.todo.doneAt ?? e.todo.createdAt) };
  if (e.source === "jira-comment") return { author: e.comment.author || null, at: e.comment.at || null };
  if (e.source === "jira") return { author: null, at: null };
  if (e.source === "work") return { author: e.run.agent, at: e.run.finishedAt ?? e.run.startedAt };
  if (e.source === "time") return { author: e.time.by, at: e.time.at };
  if (e.source === "keep") return { author: null, at: e.note.updatedAt };
  if (e.source === "fact") return { author: null, at: e.fact.updatedAt };
  if (e.source === "document") return { author: null, at: e.doc.createdAt };
  const g = e.gitlab;
  return { author: g.author, at: g.kind === "branch" ? g.updatedAt : g.createdAt };
}

/** A line naming it: "Christopher Lorenz in Chat with Christopher Lorenz", "!167 Title", "Todo T-12 on PROJ-364". */
export function entityHeadline(e: Sourced): string {
  if (e.source === "mail") return `${mailSender(e.mail)}: ${e.mail.subject}`;
  if (e.source === "teams") return [e.teams.senderName ?? "Teams message", e.teams.place ? `in ${e.teams.place}` : ""].filter(Boolean).join(" ");
  if (e.source === "todo") return `Todo ${e.todo.ref} zu ${e.todo.ticket}${e.todo.status === "done" ? " (erledigt)" : ""}`;
  if (e.source === "jira-comment") return `${e.comment.author || "Jira-Kommentar"} auf ${e.comment.ticket}`;
  if (e.source === "jira") return `${e.ticket.key} ${e.ticket.summary}`.trim();
  if (e.source === "work") return `${e.run.ref} · ${e.run.agent}${e.run.todoId ? ` an T-${e.run.todoId}` : ""}${e.run.minutes != null ? ` · ${e.run.minutes} min` : ""}`;
  if (e.source === "time") return `${e.time.todo} · ${e.time.minutes} min${e.time.note ? ` · ${e.time.note}` : ""} — ${e.time.by}`;
  if (e.source === "keep") return `Notiz: ${noteHeadline(e.note)} (${e.note.where})`;
  if (e.source === "fact") return `Fakt: ${e.fact.subject}`;
  if (e.source === "document") return `Dokument: ${e.doc.name}`;
  return gitlabHeadline(e.gitlab);
}

/** Its words as plain-ish text (Teams: the message; GitLab: the description, comment or commit message; a todo: what's to do, and how it was settled). */
export function entityText(e: Sourced): string {
  if (e.source === "teams") return [e.teams.subject, e.teams.text].filter(Boolean).join(" — ");
  if (e.source === "mail") return [e.mail.subject, e.mail.preview].filter(Boolean).join(" — ");
  if (e.source === "todo") return [e.todo.text, e.todo.note].filter(Boolean).join("\n");
  if (e.source === "jira-comment") return e.comment.text;
  if (e.source === "jira") return [e.ticket.status, e.ticket.description].filter(Boolean).join(" — ");
  if (e.source === "work") return [e.run.entryLine, e.run.summary].filter(Boolean).join("\n\n");
  if (e.source === "time") return e.time.note;
  if (e.source === "keep") return [e.note.title, e.note.text, e.note.labels.length ? `Labels: ${e.note.labels.join(", ")}` : ""].filter(Boolean).join("\n");
  if (e.source === "fact") return `${e.fact.subject}: ${e.fact.text}`;
  if (e.source === "document") return e.doc.abstract;
  return e.gitlab.body;
}

/** Where it lives: "Teams" / "GitLab" / "Jira" / "Todo". */
export const entitySourceLabel = (e: Sourced) =>
  e.source === "teams" ? "Teams" : e.source === "gitlab" ? "GitLab" : e.source === "mail" ? "Mail" : e.source === "todo" ? "Todo" : e.source === "work" ? "Lauf" : e.source === "time" ? "Zeit" : e.source === "keep" ? "Notiz" : e.source === "fact" ? "Fakt" : e.source === "document" ? "Dokument" : "Jira";

/** Whether it's been dealt with (marked done here, resolved where it lives). */
export const entityDone = (e: Sourced): boolean =>
  e.source === "teams"
    ? !!e.teams.resolvedAt
    : e.source === "gitlab"
      ? gitlabDone(e.gitlab)
      : e.source === "jira-comment"
        ? e.comment.resolved
        : e.source === "mail"
          ? !!e.mail.resolvedAt
          : e.source === "todo"
            ? e.todo.status !== "open"
            : e.source === "work"
              ? e.run.status === "done"
              : e.source === "keep"
                ? e.note.archived
                : false;
// (A fact is never "done": it's knowledge.)
