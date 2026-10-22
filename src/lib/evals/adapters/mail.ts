/**
 * The Mail-Durchsicht as an eval step (npm run eval:mail — once a script of its own, now an adapter of the harness). Its
 * test set: the mails behind the review's past todos — behind one you did: must; behind one you dropped: negative;
 * behind one still open: open; a must-do mail (a mandatory training, a signature) always must. Frozen as the review
 * would see them (newest 150, after the filter), with your tickets and the open todos — but without the review's own
 * todos and verdicts (they would give the answers away). A run goes through the same chain as the real one: the
 * prompt builder, the AI, the safety net that makes a todo of a must-do mail the AI skipped. Item: the mail's key.
 */
import { getSqlite } from "@/db";
import type { TodoView } from "@/lib/boards/shared";
import type { EvalAdapter, EvalCase, Label } from "../harness";
import { mergeLabel } from "../golden";

type Mail = { key: string; folder: string; fromName: string | null; fromEmail: string | null; subject: string; preview: string; receivedAt: string };
/** An open todo, as much of it as the prompt and the safety net read. */
type OpenTodo = Pick<TodoView, "id" | "ticket" | "text" | "due" | "refs" | "planned">;
export type MailInput = { mails: Mail[]; tickets: string[]; open: OpenTodo[] };

const SOURCE = "Mail-Durchsicht";
const MAX = 150;

export const mailAdapter: EvalAdapter<MailInput> = {
  step: "mail",
  title: "Mail-Durchsicht",
  task: "mail-todos",
  prompt: { file: "src/lib/boards/mail-todos.ts" },
  costUsd: 1,
  async build() {
    const { lastGoodRun, listTodos } = await import("@/lib/boards/store");
    const { mustDo, notForReview } = await import("@/lib/boards/mail-todos");
    const { isInstalled } = await import("@/plugins/state");
    const db = getSqlite();
    const rows = db
      .prepare(
        `select t.status, t.refs, (select e.actor from todo_events e where e.todo_id = t.id and e.event in ('done','dismissed') order by e.id desc limit 1) as by
         from todos t where t.source = ?`,
      )
      .all(SOURCE) as { status: string; refs: string; by: string | null }[];
    const labels: Record<string, Label> = {};
    for (const r of rows) {
      const l: Label | null = r.status === "done" ? "must" : r.status === "dismissed" && r.by === "you" ? "negative" : r.status === "open" ? "open" : null;
      if (!l) continue;
      for (const ref of JSON.parse(r.refs) as string[]) if (ref.startsWith("mail:")) labels[ref.slice(5)] = mergeLabel(labels[ref.slice(5)], l);
    }
    const get = db.prepare("select key, folder, from_name as fromName, from_email as fromEmail, subject, preview, received_at as receivedAt from emails where key = ?");
    const mails = Object.keys(labels)
      .map((k) => get.get(k) as Mail | undefined)
      .filter((m): m is Mail => !!m && !notForReview(m, isInstalled("gitlab")))
      .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
      .slice(-MAX);
    if (!mails.length) return [];
    for (const m of mails) if (mustDo(m)) labels[m.key] = "must";
    const open = listTodos({ status: "open" })
      .filter((t) => t.source !== SOURCE)
      .map((t): OpenTodo => ({ id: t.id, ticket: t.ticket, text: t.text, due: t.due, refs: t.refs, planned: t.planned }));
    const c: EvalCase<MailInput> = {
      id: "mail-1",
      input: { mails, tickets: (lastGoodRun()?.tickets ?? []).map((t) => `- ${t.key}`), open },
      labels: Object.fromEntries(mails.map((m) => [m.key, labels[m.key]])),
      what: Object.fromEntries(mails.map((m) => [m.key, `${m.fromName ?? m.fromEmail ?? "?"} „${m.subject.slice(0, 70)}“${mustDo(m) ? " (Pflicht)" : ""}`])),
    };
    return [c];
  },
  async run(c, instructions, ask) {
    const { mailReviewPrompt, mustDoLeftOut, MAIL_REVIEW_SCHEMA } = await import("@/lib/boards/mail-todos");
    const { mails, tickets } = c.input;
    const open = c.input.open.map((t) => ({ userNotes: [], ...t }) as unknown as TodoView);
    const answer = (await ask(mailReviewPrompt({ instructions, tickets, open, verdicts: { dropped: [], done: [] }, mails }), MAIL_REVIEW_SCHEMA, { task: "mail-todos", step: "mail" })) as {
      todos?: { refs?: unknown[] }[];
      updates?: { refs?: unknown[] }[];
    } | null;
    const keyOf = (r: unknown) => String(r).trim().replace(/^\[|\]$/g, "").replace(/^mail:/, "");
    const covered = new Set([...(answer?.todos ?? []), ...(answer?.updates ?? [])].flatMap((t) => (Array.isArray(t?.refs) ? t.refs : []).map(keyOf)));
    for (const left of mustDoLeftOut(mails, covered, open, (k) => mails.find((m) => m.key === k))) for (const m of left.mails) covered.add(m.key);
    return covered;
  },
};
