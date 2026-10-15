import { aiChoice, runAi } from "@/lib/ai";
import { plain } from "@/lib/boards/collect";
import type { TodoView } from "@/lib/boards/shared";
import { listTodos, setTodoNoteRefs } from "@/lib/boards/store";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { getJiraTicket } from "@/lib/jira/store";
import { COPILOT_MAX_PROMPT } from "@/plugins/copilot-cli/cli";
import { briefingNotes, type Item } from "@/lib/items";

/**
 * The Notiz-Zuordnung (Google Keep's extension for Todos, a step after the Ticket-Lage): each open
 * todo gets the notes it's about — your boards in the Lage and Google Keep's. Too many notes to show
 * them all: per todo the likeliest few by shared words (its text, its ticket's title), then the AI
 * picks by content. They become the todo's related notes (with its related mails): shown at it, in
 * its context and its agents'.
 */

/** A note: an item of a collection in the briefing (a Keep board, Google Keep, a database …), with where it is. */
type Note = Item & { where: string };

const PER_TODO = 6;
const BATCH_CHARS = COPILOT_MAX_PROMPT - 4000;

const SCHEMA = {
  type: "object",
  properties: {
    todos: { type: "array", items: { type: "object", properties: { id: { type: "integer" }, notes: { type: "array", items: { type: "string" } } }, required: ["id", "notes"] } },
  },
  required: ["todos"],
};
type Answer = { todos?: { id?: number; notes?: string[] }[] };

const INSTRUCTIONS = `Du ordnest Notizen meinen offenen Todos zu. Unten steht je Todo (Nummer in eckigen Klammern) eine Auswahl meiner Notizen aus Google Keep und meinen Notiz-Boards (Kennung in eckigen Klammern, z. B. [keep:…], dann wo sie liegt, Titel und Text).

Gib für JEDES Todo die Kennungen der Notizen an, die für genau dieses Todo relevant sind: aus denen es folgt, die etwas dazu festhalten (Absprachen, Daten, Listen, Ideen dazu) oder die man kennen muss, um es zu erledigen (bis zu 4). Nach Inhalt, nicht nach einzelnen gleichen Wörtern. Passt keine, ist die Liste leer.`;

const STOP = new Set("aber alle allem also auch dann dass dein deine denn diese dieser dies doch durch eine einem einen einer eines etwas für habe haben hast hier ihre ihren immer jetzt kann kein keine machen mehr mein meine mich mit nach nicht noch oder sehr sich sind soll über und uns unter vom von wann warum was weil wenn werden wie wird wieder will wir zum zur zwischen bitte danke from that this with have your will".split(" "));
const words = (t: string) => new Set((t.toLowerCase().match(/[a-zäöüß0-9]{4,}/g) ?? []).filter((w) => !STOP.has(w)));

/** The notes likeliest to be about a todo: most shared words (at least two), the best few. */
function candidates(todo: TodoView, notes: { n: Note; w: Set<string> }[]): Note[] {
  const summary = todo.ticket ? (getJiraTicket(todo.ticket)?.summary ?? "") : "";
  const tw = words(`${todo.text} ${summary} ${todo.note ?? ""}`);
  if (!tw.size) return [];
  return notes
    .map(({ n, w }) => ({ n, score: [...tw].filter((x) => w.has(x)).length }))
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score || (b.n.updatedAt ?? "").localeCompare(a.n.updatedAt ?? ""))
    .slice(0, PER_TODO)
    .map((x) => x.n);
}

const noteLine = (n: Note) => `  - [${n.ref}] (${n.where}) „${plain(n.title || "(ohne Titel)", 160)}“ — ${plain(n.text, 500)}`;
const block = (t: TodoView, list: Note[]) => [`## [${t.id}] ${plain(t.text, 300)}${t.ticket ? ` (${t.ticket})` : ""}`, ...list.map(noteLine)].join("\n");

const state = globalThis as unknown as { __zeffNoteRelations?: Promise<NoteRelationResult> | null };
export type NoteRelationResult = { ok: boolean; todos: number; changed: number; batches: number; error?: string };

export function relateNotes(): Promise<NoteRelationResult> {
  if (state.__zeffNoteRelations) return state.__zeffNoteRelations;
  const run = (async (): Promise<NoteRelationResult> => {
    const open = listTodos({ status: "open" });
    const notes = briefingNotes()
      .map(({ item, collection }): Note => ({ ...item, where: collection.name }))
      .filter((n) => n.title || n.text.trim())
      .map((n) => ({ n, w: words(`${n.title} ${n.text} ${n.labels.join(" ")}`) }));
    const picks = new Map<number, string[]>();
    const groups: { t: TodoView; list: Note[] }[] = [];
    for (const t of open) {
      const list = candidates(t, notes);
      if (list.length) groups.push({ t, list });
      else picks.set(t.id, []); // nothing likely: no notes
    }
    const limit = aiChoice().provider === "copilot" ? BATCH_CHARS : 3 * BATCH_CHARS;
    const batches: (typeof groups)[] = [];
    let size = 0;
    for (const g of groups) {
      const n = block(g.t, g.list).length;
      if (!batches.length || size + n > limit) {
        batches.push([]);
        size = 0;
      }
      batches[batches.length - 1].push(g);
      size += n;
    }
    let failed = 0;
    for (const batch of batches) {
      const prompt = `${INSTRUCTIONS}\n\n${batch.map((g) => block(g.t, g.list)).join("\n\n")}`;
      // A batch that fails: its todos keep the notes they have.
      const answer = await runAi<Answer>(prompt, SCHEMA, { task: "note-relations", timeoutMs: 10 * 60000, maxBudgetUsd: 1 }).catch((e) => {
        console.error("[note-relations]", errorMessage(e));
        failed++;
        return null;
      });
      if (!answer) continue;
      const said = new Map((answer.output?.todos ?? []).filter((t) => Number.isInteger(t?.id)).map((t) => [t.id!, t.notes ?? []]));
      for (const g of batch) {
        const known = new Set(g.list.map((n) => n.ref));
        const refs = (said.get(g.t.id) ?? []).map((r) => String(r).trim().replace(/^\[|\]$/g, "")).map((r) => (known.has(r) ? r : `keep:${r}`));
        picks.set(g.t.id, refs.filter((r) => known.has(r)).slice(0, 4));
      }
    }
    const changed = setTodoNoteRefs(picks);
    return { ok: failed < batches.length || !batches.length, todos: picks.size, changed, batches: batches.length, ...(failed ? { error: t("{failed} of {n} parts failed", { failed, n: batches.length }) } : {}) };
  })()
    .catch((e): NoteRelationResult => {
      console.error("[note-relations]", errorMessage(e));
      return { ok: false, todos: 0, changed: 0, batches: 0, error: errorMessage(e) };
    })
    .finally(() => {
      state.__zeffNoteRelations = null;
    });
  state.__zeffNoteRelations = run;
  return run;
}
