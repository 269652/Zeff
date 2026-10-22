import { mustDo } from "@/lib/boards/must-do";
import { isChatFolder } from "@/lib/mail/shared";
import { ledgerDb, recordFeedback, STEPS } from "./ledger";
import { subjectStem } from "./rules";

/**
 * The todos' part of the ledger, read from their history (todo_events — the triggers write every status change, and
 * `attributed` says who): a todo an AI step made that you closed — done is accepted, dropped is rejected. The same
 * function is the live hook (`attributed("you", …)` hands it the events it just attributed) and the backfill (all events
 * of the last half year): each event is written once, keyed "todo-event:<id>".
 *
 * A todo of the mail review brings its mail's sender and subject stem (the pattern rules learn from) and whether the mail
 * was protected — a must-do mail, a chat, a question — which no rule may ever learn from.
 */

type Ev = { id: number; todo_id: number; event: string; at: string; text: string; source: string | null; kind: string | null; refs: string | null; made_by: string | null };

/** The AI step a todo came from (null: yours, a plan's, an agent's — not an AI proposal). */
export function stepOfTodo(source: string | null, madeBy: string | null): string | null {
  if (source === "Mail-Durchsicht") return STEPS.mailReview;
  if (source === "Notiz-Durchsicht") return STEPS.noteReview;
  if (source === "Dokument-Durchsicht") return STEPS.documentReview;
  if (madeBy === "mail") return STEPS.mailReview;
  if (madeBy === "keep") return STEPS.noteReview;
  if (madeBy?.startsWith("lage:")) return STEPS.lage;
  if (madeBy?.startsWith("work:")) return STEPS.workers;
  return null;
}

type Mail = { folder: string; from_name: string | null; from_email: string | null; subject: string; preview: string };

/**
 * Your closing of AI-made todos, into the ledger: the events after `afterId` (the live hook), or since a time (the
 * backfill; default the last 180 days). How many were new.
 */
export function ingestTodoEvents(opts: { afterId?: number; since?: string; limit?: number } = {}): number {
  try {
    const db = ledgerDb();
    const since = opts.since ?? new Date(Date.now() - 180 * 864e5).toISOString();
    const rows = db
      .prepare(
        `select e.id, e.todo_id, e.event, e.at, e.text, t.source, t.kind, t.refs,
           (select c.actor from todo_events c where c.todo_id = e.todo_id and c.event = 'created' order by c.id limit 1) as made_by
         from todo_events e join todos t on t.id = e.todo_id
         where e.actor = 'you' and e.event in ('done', 'dismissed') and e.id > ? and e.at >= ?
         order by e.id limit ?`,
      )
      .all(opts.afterId ?? 0, opts.afterId ? "" : since, opts.limit ?? 5000) as Ev[];
    let n = 0;
    const mailOf = db.prepare(`select folder, from_name, from_email, subject, preview from emails where key = ?`);
    for (const e of rows) {
      const step = stepOfTodo(e.source, e.made_by);
      if (!step) continue;
      let refs: string[] = [];
      try {
        refs = JSON.parse(e.refs ?? "[]");
      } catch {
        // none
      }
      const mailRef = refs.find((r) => typeof r === "string" && r.startsWith("mail:"));
      const m = mailRef ? (mailOf.get(mailRef.slice(5)) as Mail | undefined) : undefined;
      const mail = m ? { fromName: m.from_name, fromEmail: m.from_email, subject: m.subject, preview: m.preview, folder: m.folder } : null;
      const detail: Record<string, unknown> = { text: e.text, todoKind: e.kind };
      if (mail) Object.assign(detail, { subject: mail.subject, folder: mail.folder, mustDo: mustDo(mail), chat: isChatFolder(mail.folder), question: /\?/.test(`${mail.subject} ${mail.preview}`) });
      const fromMail = step === STEPS.mailReview && mail;
      if (
        recordFeedback({
          step,
          itemRef: `todo:${e.todo_id}`,
          verdict: e.event === "done" ? "accepted" : "rejected",
          at: e.at,
          sourceRef: mailRef ?? refs.find((r) => typeof r === "string") ?? null,
          sender: fromMail ? mail.fromEmail : null,
          kind: fromMail ? subjectStem(mail.subject) : e.kind,
          detail,
          key: `todo-event:${e.id}`,
        })
      )
        n++;
    }
    return n;
  } catch (err) {
    console.error("[ai-feedback] todos", err);
    return 0;
  }
}
