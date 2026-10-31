/**
 * Gmail's action run through Google's API — only from its own buttons (your click on a todo's mail: "Send" or "Save as draft";
 * your reply from an inbox row), never by the todo's "Run", a worker or an agent: those leave a mail as Gmail's window, filled in,
 * for you to send. A mail that answers one of Gmail's goes into that conversation. And a conversation of an inbox row archived or
 * marked unread. Server only.
 */
import { inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { TodoOp, TodoView } from "@/lib/todos/shared";
import { archiveGmail, createGmailDraft, markGmailUnread, sendGmail } from "@/lib/google/gmail-send";
import { gmailCanWrite } from "@/lib/google/gmail-write";
import { journalGoogleWrite } from "@/lib/google/journal";
import { t } from "@/lib/i18n/server";
import type { ActionResult } from "../actions/run-types";

export type ComposeMode = "send" | "draft";
type Compose = Extract<TodoOp, { type: "gmail-compose" }>;

const noRight = () => new Error(t("Google was only asked for read access to Gmail. Allow writing to Gmail on the Connections page and sign in to Google again."));
const stripRe = (s: string) => s.replace(/^\s*((re|aw|fw|fwd|wg)\s*:\s*)+/i, "").trim().toLowerCase();
const addressesOf = (s: string) => (s.match(/[^\s<>,;"]+@[^\s<>,;"]+/g) ?? []).map((x) => x.toLowerCase());

/**
 * The Gmail conversation a todo's mail answers: of the Gmail mails the todo came from, the one whose sender it goes to — or whose
 * subject it answers; a reply ("Re: …") to the only one. None: a new conversation.
 */
export function gmailThreadOf(todo: Pick<TodoView, "refs">, op: Pick<Compose, "to" | "subject">): string | null {
  const keys = todo.refs.filter((r) => r.startsWith("mail:gmail:")).map((r) => r.slice(5));
  if (!keys.length) return null;
  const mails = getDb().select({ convId: schema.emails.convId, fromEmail: schema.emails.fromEmail, subject: schema.emails.subject }).from(schema.emails).where(inArray(schema.emails.key, keys)).all();
  const to = addressesOf(op.to);
  const bySender = mails.find((m) => m.fromEmail && to.includes(m.fromEmail.toLowerCase()));
  if (bySender) return bySender.convId;
  const bySubject = mails.find((m) => stripRe(m.subject) && stripRe(m.subject) === stripRe(op.subject));
  if (bySubject) return bySubject.convId;
  const convs = [...new Set(mails.map((m) => m.convId))];
  return /^\s*(re|aw)\s*:/i.test(op.subject) && convs.length === 1 ? convs[0] : null;
}

/** The mail sent (or saved as a draft) through Gmail's API — into `thread` when it answers one. */
export async function runGmailCompose(op: Compose, o: { mode: ComposeMode; thread?: string | null; refs?: string[] }): Promise<ActionResult> {
  if (!gmailCanWrite()) throw noRight();
  const mail = { to: op.to, subject: op.subject, body: op.body, ...(o.thread ? { thread: o.thread } : {}) };
  const to = op.to.replace(/;/g, ", ");
  if (o.mode === "draft") {
    const d = await createGmailDraft(mail);
    journalGoogleWrite({ kind: "mail.draft", source: "gmail", sourceRef: `draft:${d.draftId}`, title: op.subject, summary: `→ ${to}`, url: "https://mail.google.com/mail/u/0/#drafts", refs: o.refs });
    const what = t("Draft “{subject}” to {to} saved in Gmail.", { subject: op.subject, to });
    return { what, todoNote: what };
  }
  const r = await sendGmail(mail);
  journalGoogleWrite({ kind: "mail.sent", source: "gmail", sourceRef: r.id, title: op.subject, summary: `→ ${to}`, url: `https://mail.google.com/mail/u/0/#all/${r.threadId}`, refs: o.refs });
  const what = t("Mail “{subject}” sent to {to} (Gmail).", { subject: op.subject, to });
  return { what, todoNote: what };
}

/** A todo's mail — your click on its "Send" / "Save as draft": run, then off the todo and noted there (a reply that was the todo: done). */
export async function runGmailComposeOnTodo(todoId: number, index: number, mode: ComposeMode): Promise<{ what: string; settled: boolean }> {
  const { clickedOp, settleClickedOp } = await import("../actions/clicked");
  const { todo, op } = await clickedOp(todoId, index, "gmail-compose");
  if (!gmailCanWrite()) throw noRight();
  const r = await runGmailCompose(op, { mode: mode === "draft" ? "draft" : "send", thread: gmailThreadOf(todo, op), refs: [`todo:${todo.id}`, ...todo.refs.filter((x) => x.startsWith("mail:"))] });
  return { what: r.what, settled: await settleClickedOp(todo, op, r.what) };
}

/** An inbox row's Gmail conversation archived (out of the inbox — nothing deleted) or marked unread. */
export async function gmailRowChange(rowId: number, what: "archive" | "unread"): Promise<string> {
  const { rowMailConv } = await import("../workspace/row-actions");
  return gmailConvChange(rowMailConv(Number(rowId)) ?? "", what);
}

/** A Gmail conversation ("gmail:…" — the inbox's) archived (out of the inbox — nothing deleted) or marked unread. */
export async function gmailConvChange(conv: string, what: "archive" | "unread"): Promise<string> {
  if (!conv.startsWith("gmail:")) throw new Error(t("Not a Gmail conversation."));
  if (!gmailCanWrite()) throw noRight();
  if (what === "archive") {
    await archiveGmail(conv);
    return t("Archived in Gmail.");
  }
  await markGmailUnread(conv);
  return t("Marked unread in Gmail.");
}
