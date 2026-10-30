/**
 * The Dokument-Zuordnung (the Documents plugin's extension for Todos, a step after the Ticket-Lage):
 * each open todo gets the documents it's about. Too many documents to show them all: per todo the
 * likeliest few by shared words (its text, its ticket's title ↔ a document's name, abstract,
 * concepts and the beginning of its text), then the AI picks by content. They become the todo's
 * related documents (with its related mails and notes): shown at it, in its context and its
 * agents'. Documents you attached by hand stay as they are. Server only.
 */
import { promptText } from "@/lib/prompts";
import { plain } from "@/lib/boards/collect";
import type { TodoView } from "@/lib/boards/shared";
import { listTodos, setTodoDocRefs } from "@/lib/boards/store";
import { getJiraTicket } from "@/lib/jira/store";
import { COPILOT_MAX_PROMPT } from "@/plugins/copilot-cli/cli";
import { readableDocuments, type ReadableDoc } from "./store";
import { promptRoom, relateInBatches, relateJob } from "@/lib/ai/batch-job";

const PER_TODO = 6;
const BATCH_CHARS = COPILOT_MAX_PROMPT - 4000;

const SCHEMA = {
  type: "object",
  properties: {
    todos: { type: "array", items: { type: "object", properties: { id: { type: "integer" }, docs: { type: "array", items: { type: "string" } } }, required: ["id", "docs"] } },
  },
  required: ["todos"],
};

export const INSTRUCTIONS = `Du ordnest Dokumente meinen offenen Todos zu. Unten steht je Todo (Nummer in eckigen Klammern) eine Auswahl meiner abgelegten Dokumente (Kennung in eckigen Klammern, z. B. [doc:12], dann Name, Art, Kurzfassung und der Textanfang).

Gib für JEDES Todo die Kennungen der Dokumente an, die für genau dieses Todo relevant sind: aus denen es folgt, die etwas dazu festhalten (Verträge, Rechnungen, Absprachen, Berichte, Fristen, Zahlen) oder die man kennen muss, um es zu erledigen (bis zu 4). Nach Inhalt, nicht nach einzelnen gleichen Wörtern. Passt keines, ist die Liste leer.`;

const STOP = new Set("aber alle allem also auch dann dass dein deine denn diese dieser dies doch durch eine einem einen einer eines etwas für habe haben hast hier ihre ihren immer jetzt kann kein keine machen mehr mein meine mich mit nach nicht noch oder sehr sich sind soll über und uns unter vom von wann warum was weil wenn werden wie wird wieder will wir zum zur zwischen bitte danke from that this with have your will".split(" "));
export const words = (text: string) => new Set((text.toLowerCase().match(/[a-zäöüß0-9]{4,}/g) ?? []).filter((w) => !STOP.has(w)));

/** The documents likeliest to be about a todo: most shared words (at least two), the best few. */
export function candidates(todo: TodoView, docs: { d: ReadableDoc; w: Set<string> }[]): ReadableDoc[] {
  const summary = todo.ticket ? (getJiraTicket(todo.ticket)?.summary ?? "") : "";
  const tw = words(`${todo.text} ${summary} ${todo.note ?? ""}`);
  if (!tw.size) return [];
  return docs
    .map(({ d, w }) => ({ d, score: [...tw].filter((x) => w.has(x)).length }))
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score || b.d.createdAt.localeCompare(a.d.createdAt))
    .slice(0, PER_TODO)
    .map((x) => x.d);
}

const docLine = (d: ReadableDoc) => `  - [${d.ref}] „${plain(d.name, 120)}“ (${d.kind})${d.abstract ? ` — ${plain(d.abstract, 400)}` : ""}\n    ${plain(d.text, 500)}`;
const block = (todo: TodoView, list: ReadableDoc[]) => [`## [${todo.id}] ${plain(todo.text, 300)}${todo.ticket ? ` (${todo.ticket})` : ""}`, ...list.map(docLine)].join("\n");

export type DocRelationResult = { ok: boolean; todos: number; changed: number; batches: number; error?: string };

export function relateDocuments(): Promise<DocRelationResult> {
  return relateJob("__zeffDocRelations", "doc-relations", async () => {
    const open = listTodos({ status: "open" });
    const docs = readableDocuments().map((d) => ({ d, w: words(`${d.name} ${d.abstract} ${d.concepts} ${d.text.slice(0, 4000)}`) }));
    const picks = new Map<number, string[]>();
    const groups: { todo: TodoView; list: ReadableDoc[] }[] = [];
    for (const todo of open) {
      const list = candidates(todo, docs);
      if (list.length) groups.push({ todo, list });
      else picks.set(todo.id, []); // nothing likely: no documents
    }
    // A batch that fails: its todos keep the documents they have.
    const { batches, failed } = await relateInBatches({
      task: "doc-relations",
      groups,
      block: (g) => block(g.todo, g.list),
      room: promptRoom(BATCH_CHARS),
      prompt: (blocks) => `${promptText("doc-relations", INSTRUCTIONS)}\n\n${blocks}`,
      schema: SCHEMA,
      field: "docs",
      take: (g, said) => {
        const known = new Set(g.list.map((d) => d.ref));
        const refs = (said.get(g.todo.id) ?? []).map((r) => String(r).trim().replace(/^\[|\]$/g, "")).map((r) => (r.startsWith("doc:") ? r : `doc:${r}`));
        picks.set(g.todo.id, refs.filter((r) => known.has(r)).slice(0, 4));
      },
    });
    const changed = setTodoDocRefs(picks);
    return { todos: picks.size, changed, batches, failed };
  });
}
