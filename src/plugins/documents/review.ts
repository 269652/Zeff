/**
 * The Dokument-Durchsicht (the Documents plugin's extension for Todos, a step after the Ticket-Lage):
 * the AI reads the documents new or changed since it last read them and makes todos of what they
 * ask of you — a deadline, a form to submit, a bill to pay, a question to answer, a task in a
 * report — the document as the todo's source. A document is read again only once its text changes.
 * In batches, each its own prompt; one at a time. Server only.
 */
import { getSqlite } from "@/db";
import { runAi, aiChoice } from "@/lib/ai";
import { attributed } from "@/lib/boards/activity";
import { plain } from "@/lib/boards/collect";
import { isTodoKind, TODO_KINDS } from "@/lib/boards/shared";
import { duplicateTodo } from "@/lib/boards/similar";
import { addDocTodo, droppedByYou, lastGoodRun, listTodos } from "@/lib/boards/store";
import { errorMessage } from "@/lib/errors";
import { emitChange } from "@/lib/events";
import { t } from "@/lib/i18n/server";
import { getJiraTicket } from "@/lib/jira/store";
import { isoDate } from "@/lib/week";
import { COPILOT_MAX_PROMPT } from "@/plugins/copilot-cli/cli";
import { readableDocuments, type ReadableDoc } from "./store";

const BATCH_CHARS = COPILOT_MAX_PROMPT - 6000;
/** How much of a document the AI reads: its beginning and — where reports and letters put what's asked — its end. */
const HEAD = 4500;
const TAIL = 3000;

const SCHEMA = {
  type: "object",
  properties: {
    todos: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          kind: { type: "string", enum: [...TODO_KINDS] },
          owner: { type: "string", enum: ["me", "other"] },
          ticket: { type: "string" },
          due: { type: "string", description: "Frist als JJJJ-MM-TT, wenn das Dokument eine nennt — sonst weglassen." },
          refs: { type: "array", items: { type: "string" } },
        },
        required: ["text", "refs"],
      },
    },
  },
  required: ["todos"],
};
type Answer = { todos?: { text?: string; kind?: string; owner?: string; ticket?: string; due?: string; refs?: string[] }[] };

const INSTRUCTIONS = `Du gehst meine abgelegten Dokumente durch (Briefe, Rechnungen, Verträge, Berichte, Protokolle, Formulare, Notizen, Scans) und findest, was ICH zu tun habe. Unten stehen die Dokumente (Kennung in eckigen Klammern, z. B. [doc:12], dann Name, Art, Ablagedatum, Kurzfassung und Text — bei langen Dokumenten Anfang und Ende), meine Tickets und die Todos, die schon offen sind.

Lege für jede Aufgabe, die ein Dokument an mich stellt, ein Todo an: ein Satz, Verb zuerst, prüfbar, mit Frist, wenn das Dokument eine nennt (die Frist auch als Datum unter due, JJJJ-MM-TT) — z. B. „Rechnung 4711 über 186,83 € bis 16.10. bezahlen“, „Mietvertrag bis zum 3. Werktag kündigen, falls nicht verlängert werden soll“, „Offene Frage zur Spalte ‚Anmerkung‘ im Migrationsbericht klären“, „Formular unterschreiben und zurücksenden“. Gehören mehrere Punkte zusammen, ist es EIN Todo. Zu jedem Todo unter refs die Kennungen der Dokumente, aus denen es folgt. Gehört es zu einem meiner Tickets, gib dessen Schlüssel unter ticket an, sonst lass ticket leer. owner = other nur, wenn ich auf jemand anderen warte (eine Antwort, eine Lieferung).

KEINE Todos für: reine Information und Nachschlagewerke, Berichte über Vergangenes ohne offene Punkte oder Fragen, Werbung, Zugangsdaten, Erledigtes (schon bezahlt, schon abgegeben, laut Dokument abgeschlossen) — und nichts, was ein schon offenes Todo abdeckt. Ein Dokument ohne Aufgabe ergibt kein Todo; gibt es insgesamt nichts zu tun, ist die Liste leer.`;

function db() {
  const d = getSqlite();
  d.exec("create table if not exists doc_reviewed (id integer primary key, version text not null, reviewed_at text not null)");
  return d;
}

const state = globalThis as unknown as { __zeffDocTodos?: Promise<DocTodosResult> | null };
export type DocTodosResult = { ok: boolean; reviewed: number; added: number; /** New todos that repeated an open one and were merged into it. */ merged?: number; batches: number; error?: string };

/** The part of a document's text the AI reads. */
export function excerpt(text: string): string {
  const s = text.trim();
  return s.length <= HEAD + TAIL + 200 ? s : `${s.slice(0, HEAD)}\n[… ${s.length - HEAD - TAIL} Zeichen ausgelassen …]\n${s.slice(-TAIL)}`;
}

/** The documents to read now: not read at this version of their text. */
function unread(): ReadableDoc[] {
  const seen = new Map((db().prepare("select id, version from doc_reviewed").all() as { id: number; version: string }[]).map((r) => [r.id, r.version]));
  return readableDocuments().filter((d) => seen.get(d.id) !== d.version);
}

const line = (d: ReadableDoc) =>
  `- [${d.ref}] „${plain(d.name, 120)}“ (${d.kind}, abgelegt ${d.createdAt.slice(0, 10)})${d.abstract ? `\n  Kurzfassung: ${plain(d.abstract, 600)}` : ""}\n  Text:\n${excerpt(d.text)
    .split("\n")
    .map((l) => `    ${l}`)
    .join("\n")}`;

export function reviewDocumentsForTodos(runId: number | null = null): Promise<DocTodosResult> {
  if (state.__zeffDocTodos) return state.__zeffDocTodos;
  const run = (async (): Promise<DocTodosResult> => {
    const docs = unread();
    const mark = (list: ReadableDoc[]) => {
      const d = db();
      const put = d.prepare("insert into doc_reviewed (id, version, reviewed_at) values (?, ?, ?) on conflict(id) do update set version = excluded.version, reviewed_at = excluded.reviewed_at");
      const now = new Date().toISOString();
      d.transaction(() => list.forEach((x) => put.run(x.id, x.version, now)))();
    };
    // Those a todo already has as its source: gone through (a document you attached to a todo by hand is that todo's context).
    const cited = new Set(listTodos({ status: "all" }).flatMap((x) => x.refs.filter((r) => r.startsWith("doc:"))));
    const theirs = docs.filter((d) => cited.has(d.ref));
    mark(theirs);
    const todo = docs.filter((d) => !cited.has(d.ref)).sort((a, b) => a.version.localeCompare(b.version));
    if (!todo.length) return { ok: true, reviewed: theirs.length, added: 0, batches: 0 };

    const tickets = lastGoodRun()?.tickets.map((x) => x.key) ?? [];
    const ticketLines = tickets.map((k) => `- ${k}${getJiraTicket(k)?.summary ? ` — ${plain(getJiraTicket(k)!.summary, 120)}` : ""}`);
    const limit = aiChoice().provider === "copilot" ? BATCH_CHARS : 3 * BATCH_CHARS;
    const batches: ReadableDoc[][] = [];
    let size = 0;
    for (const d of todo) {
      const len = line(d).length + 1;
      if (!batches.length || size + len > limit) {
        batches.push([]);
        size = 0;
      }
      batches[batches.length - 1].push(d);
      size += len;
    }

    let added = 0;
    let merged = 0;
    let failed = 0;
    let reviewed = theirs.length;
    for (const batch of batches) {
      const open = listTodos({ status: "open" });
      // What you dropped isn't proposed again.
      const dropped = droppedByYou();
      const prompt = [
        INSTRUCTIONS,
        "",
        `Heute ist ${new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} (${isoDate(new Date())}).`,
        "",
        "# Meine Tickets",
        ...(ticketLines.length ? ticketLines : ["(keine)"]),
        "",
        "# Schon offene Todos",
        ...open.slice(0, 60).map((x) => `- [${x.id}]${x.ticket ? ` ${x.ticket}` : ""}: ${plain(x.text, 160)}`),
        "",
        "# Dokumente",
        ...batch.map(line),
      ].join("\n");
      const answer = await runAi<Answer>(prompt, SCHEMA, { task: "doc-todos", timeoutMs: 10 * 60000, maxBudgetUsd: 1 }).catch((e) => {
        console.error("[doc-todos]", errorMessage(e));
        failed++;
        return null;
      });
      // A batch that fails: its documents are read next time.
      if (!answer) continue;
      const known = new Set(batch.map((d) => d.ref));
      for (const td of answer.output?.todos ?? []) {
        const text = td.text?.trim();
        const refs = (td.refs ?? []).map((r) => String(r).trim().replace(/^\[|\]$/g, "")).map((r) => (r.startsWith("doc:") ? r : `doc:${r}`)).filter((r) => known.has(r));
        if (!text || !refs.length) continue;
        const ticket = td.ticket?.trim().toUpperCase() ?? "";
        // One you dropped isn't made again; one that repeats an open todo is merged into it (the gate).
        if (!duplicateTodo({ text, ops: [] }, open) && duplicateTodo({ text, ops: [] }, dropped)) continue;
        const made = attributed(runId ? `lage:${runId}` : "documents", () =>
          addDocTodo({ ticket: tickets.includes(ticket) ? ticket : "", text, kind: isTodoKind(td.kind) ? td.kind : "other", owner: td.owner === "other" ? "other" : "me", refs, runId, due: td.due ?? null }),
        );
        if (made.outcome === "merged") merged++;
        else if (!made.outcome) {
          open.push(made);
          added++;
        }
      }
      mark(batch);
      reviewed += batch.length;
    }
    if (added || merged) emitChange("todos");
    return { ok: failed < batches.length, reviewed, added, merged, batches: batches.length, ...(failed ? { error: t("{failed} of {n} parts failed", { failed, n: batches.length }) } : {}) };
  })()
    .catch((e): DocTodosResult => {
      console.error("[doc-todos]", errorMessage(e));
      return { ok: false, reviewed: 0, added: 0, batches: 0, error: errorMessage(e) };
    })
    .finally(() => {
      state.__zeffDocTodos = null;
    });
  state.__zeffDocTodos = run;
  return run;
}
