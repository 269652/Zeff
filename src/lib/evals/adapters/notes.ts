/**
 * The Notiz-Durchsicht as an eval step: the notes behind its past todos (Keep, your note boards, the databases in
 * the briefing) — behind one you did: must; dropped by you: negative; still open: open. Frozen as the review lists
 * them (noteLine), with your tickets and the open todos (not its own). A run: the step's prompt builder, the AI, the
 * notes each todo of the answer names (a todo without text names nothing). Item: the note's ref.
 */
import { getSqlite } from "@/db";
import type { EvalAdapter, EvalCase, Label } from "../harness";
import { mergeLabel } from "../golden";

export type NotesInput = { notes: { ref: string; line: string }[]; ticketLines: string[]; open: { id: number; ticket: string; text: string }[] };

const SOURCE = "Notiz-Durchsicht";
const PER_CASE = 40;

export const notesAdapter: EvalAdapter<NotesInput> = {
  step: "notes",
  title: "Notiz-Durchsicht",
  task: "note-todos",
  prompt: { file: "src/plugins/keep/note-review.ts" },
  costUsd: 1,
  async build() {
    const { lastGoodRun, listTodos } = await import("@/lib/boards/store");
    const { briefingNotes } = await import("@/lib/items");
    const { noteLine } = await import("@/plugins/keep/note-review");
    const { getJiraTicket } = await import("@/lib/jira/store");
    const { plain } = await import("@/lib/boards/collect");
    const rows = getSqlite()
      .prepare(
        `select t.status, t.refs, (select e.actor from todo_events e where e.todo_id = t.id and e.event in ('done','dismissed') order by e.id desc limit 1) as by
         from todos t where t.source = ?`,
      )
      .all(SOURCE) as { status: string; refs: string; by: string | null }[];
    const labels: Record<string, Label> = {};
    for (const r of rows) {
      const l: Label | null = r.status === "done" ? "must" : r.status === "dismissed" && r.by === "you" ? "negative" : r.status === "open" ? "open" : null;
      if (l) for (const ref of JSON.parse(r.refs) as string[]) labels[ref] = mergeLabel(labels[ref], l);
    }
    const notes = briefingNotes()
      .map(({ item, collection }) => ({ ...item, where: collection.name }))
      .filter((n) => n.ref in labels)
      .sort((a, b) => (a.updatedAt ?? a.createdAt ?? "").localeCompare(b.updatedAt ?? b.createdAt ?? ""));
    if (!notes.length) return [];
    const ticketLines = (lastGoodRun()?.tickets.map((t) => t.key) ?? []).map((k) => `- ${k}${getJiraTicket(k)?.summary ? ` — ${plain(getJiraTicket(k)!.summary, 120)}` : ""}`);
    const open = listTodos({ status: "open" })
      .filter((t) => t.source !== SOURCE)
      .map((t) => ({ id: t.id, ticket: t.ticket, text: t.text }));
    const cases: EvalCase<NotesInput>[] = [];
    for (let i = 0; i < notes.length; i += PER_CASE) {
      const batch = notes.slice(i, i + PER_CASE);
      cases.push({
        id: `notes-${cases.length + 1}`,
        input: { notes: batch.map((n) => ({ ref: n.ref, line: noteLine(n) })), ticketLines, open },
        labels: Object.fromEntries(batch.map((n) => [n.ref, labels[n.ref]])),
        what: Object.fromEntries(batch.map((n) => [n.ref, `${n.where}: „${(n.title || n.text).slice(0, 70)}“`])),
      });
    }
    return cases;
  },
  async run(c, instructions, ask) {
    const { noteReviewPrompt, noteRefsOf, NOTE_REVIEW_SCHEMA } = await import("@/plugins/keep/note-review");
    const { notes, ticketLines, open } = c.input;
    const answer = (await ask(noteReviewPrompt({ instructions, ticketLines, open, lines: notes.map((n) => n.line) }), NOTE_REVIEW_SCHEMA, { task: "note-todos", step: "notes" })) as {
      todos?: { text?: string; refs?: unknown }[];
    } | null;
    const known = new Set(notes.map((n) => n.ref));
    return new Set((answer?.todos ?? []).filter((t) => String(t?.text ?? "").trim()).flatMap((t) => noteRefsOf(t.refs, known)));
  },
};
