import { getSqlite } from "@/db";
import { aiChoice, runAi } from "@/lib/ai";
import { attributed } from "@/lib/boards/activity";
import { plain } from "@/lib/boards/collect";
import { isTodoKind, TODO_KINDS } from "@/lib/boards/shared";
import { duplicateTodo } from "@/lib/boards/similar";
import { addNoteTodo, droppedByYou, lastGoodRun, listTodos } from "@/lib/boards/store";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { emitChange } from "@/lib/events";
import { getJiraTicket } from "@/lib/jira/store";
import { COPILOT_MAX_PROMPT } from "@/plugins/copilot-cli/cli";
import { lageNotes, type NoteView } from "./boards";
import { isoDate } from "@/lib/week";

/**
 * The Notiz-Durchsicht (Google Keep's extension for Todos, a step after the Ticket-Lage): the AI
 * reads the notes new or edited since it last read them — your boards in the Lage and Google
 * Keep's, of the last weeks — and makes todos of what they ask of you, the notes as their source.
 * A note is read again only once it's edited. In batches, each its own prompt; one at a time.
 */

/** How far back: notes edited in the last weeks. */
const DAYS = 21;
const BATCH_CHARS = COPILOT_MAX_PROMPT - 6000;

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
          due: { type: "string", description: "Frist als JJJJ-MM-TT, wenn die Notiz eine nennt — sonst weglassen." },
          refs: { type: "array", items: { type: "string" } },
        },
        required: ["text", "refs"],
      },
    },
  },
  required: ["todos"],
};
type Answer = { todos?: { text?: string; kind?: string; owner?: string; ticket?: string; due?: string; refs?: string[] }[] };

const INSTRUCTIONS = `Du gehst meine Notizen durch (aus Google Keep und meinen eigenen Notiz-Boards) und findest, was ICH zu tun habe. Unten stehen Notizen (Kennung in eckigen Klammern, z. B. [keep:…], dann zuletzt bearbeitet, wo sie liegt, Titel und Text — Listen als „☐ …“ offen, „☑ …“ erledigt), meine Tickets und die Todos, die schon offen sind.

Lege für jede Aufgabe, die eine Notiz enthält, ein Todo an: ein Satz, Verb zuerst, prüfbar, mit Frist, wenn die Notiz eine nennt (die Frist auch als Datum unter due, JJJJ-MM-TT) — z. B. „Steuererklärung 2025 bis 31.7. abgeben“, „Anna wegen der Fotos zurückrufen“, „Reifenwechsel-Termin vereinbaren“. Offene Listenpunkte, die zusammen eine Sache sind (eine Einkaufsliste, Packliste), sind EIN Todo („Einkauf: Milch, Brot, Kaffee besorgen“), nicht eines je Punkt. Zu jedem Todo unter refs die Kennungen der Notizen, aus denen es folgt. Gehört es zu einem meiner Tickets, gib dessen Schlüssel unter ticket an, sonst lass ticket leer. owner = other nur, wenn ich auf jemand anderen warte.

KEINE Todos für: reine Infos, Ideen-Sammlungen ohne Auftrag, Zitate, Rezepte, Zugangsdaten, Erledigtes (☑), Notizen über Vergangenes — und nichts, was ein schon offenes Todo abdeckt. Gibt es nichts zu tun, ist die Liste leer.`;

function db() {
  const d = getSqlite();
  d.exec("create table if not exists keep_reviewed (ref text primary key, version text not null, reviewed_at text not null)");
  return d;
}

/** A note's version: when it was last edited (a later edit: read again). */
const versionOf = (n: NoteView) => n.updatedAt ?? n.createdAt ?? "";

const state = globalThis as unknown as { __zeffNoteTodos?: Promise<NoteTodosResult> | null };
export type NoteTodosResult = { ok: boolean; reviewed: number; added: number; /** New todos that repeated an open one and were merged into it. */ merged?: number; batches: number; error?: string };

/** The notes to read now: edited lately, not read at this version, not empty. */
function unread(): NoteView[] {
  const since = new Date(Date.now() - DAYS * 864e5).toISOString();
  const seen = new Map((db().prepare("select ref, version from keep_reviewed").all() as { ref: string; version: string }[]).map((r) => [r.ref, r.version]));
  return lageNotes().filter((n) => (n.title || n.text.trim()) && versionOf(n) >= since && seen.get(n.ref) !== versionOf(n));
}

export function reviewNotesForTodos(runId: number | null = null): Promise<NoteTodosResult> {
  if (state.__zeffNoteTodos) return state.__zeffNoteTodos;
  const run = (async (): Promise<NoteTodosResult> => {
    const notes = unread();
    const mark = (list: NoteView[]) => {
      const d = db();
      const put = d.prepare("insert into keep_reviewed (ref, version, reviewed_at) values (?, ?, ?) on conflict(ref) do update set version = excluded.version, reviewed_at = excluded.reviewed_at");
      const now = new Date().toISOString();
      d.transaction(() => list.forEach((n) => put.run(n.ref, versionOf(n), now)))();
    };
    // Those a todo already has as its source: gone through.
    const cited = new Set(listTodos({ status: "all" }).flatMap((t) => t.refs.filter((r) => r.startsWith("keep:"))));
    const theirs = notes.filter((n) => cited.has(n.ref));
    mark(theirs);
    const todo = notes.filter((n) => !cited.has(n.ref)).sort((a, b) => versionOf(a).localeCompare(versionOf(b)));
    if (!todo.length) return { ok: true, reviewed: theirs.length, added: 0, batches: 0 };

    const tickets = lastGoodRun()?.tickets.map((t) => t.key) ?? [];
    const ticketLines = tickets.map((k) => `- ${k}${getJiraTicket(k)?.summary ? ` — ${plain(getJiraTicket(k)!.summary, 120)}` : ""}`);
    const line = (n: NoteView) =>
      `- [${n.ref}] ${versionOf(n).slice(0, 16).replace("T", " ")} (${n.source === "google" ? "Google Keep" : (n.boardName ?? "Keep")}${n.labels.length ? `, Labels: ${n.labels.join(", ")}` : ""}) „${plain(n.title || "(ohne Titel)", 200)}“ — ${plain(n.text.replace(/^\s*[-*]\s\[ \]\s?/gm, "☐ ").replace(/^\s*[-*]\s\[[xX]\]\s?/gm, "☑ "), 1200)}`;
    const limit = aiChoice().provider === "copilot" ? BATCH_CHARS : 3 * BATCH_CHARS;
    const batches: NoteView[][] = [];
    let size = 0;
    for (const n of todo) {
      const len = line(n).length + 1;
      if (!batches.length || size + len > limit) {
        batches.push([]);
        size = 0;
      }
      batches[batches.length - 1].push(n);
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
        ...open.slice(0, 60).map((t) => `- [${t.id}]${t.ticket ? ` ${t.ticket}` : ""}: ${plain(t.text, 160)}`),
        "",
        "# Notizen",
        ...batch.map(line),
      ].join("\n");
      const answer = await runAi<Answer>(prompt, SCHEMA, { task: "note-todos", timeoutMs: 10 * 60000, maxBudgetUsd: 1 }).catch((e) => {
        console.error("[note-todos]", errorMessage(e));
        failed++;
        return null;
      });
      // A batch that fails: its notes are read next time.
      if (!answer) continue;
      const known = new Set(batch.map((n) => n.ref));
      for (const td of answer.output?.todos ?? []) {
        const text = td.text?.trim();
        const refs = (td.refs ?? []).map((r) => String(r).trim().replace(/^\[|\]$/g, "")).map((r) => (r.startsWith("keep:") ? r : `keep:${r}`)).filter((r) => known.has(r));
        if (!text || !refs.length) continue;
        const ticket = td.ticket?.trim().toUpperCase() ?? "";
        // One you dropped isn't made again; one that repeats an open todo is merged into it (the gate).
        if (!duplicateTodo({ text, ops: [] }, open) && duplicateTodo({ text, ops: [] }, dropped)) continue;
        const t = attributed(runId ? `lage:${runId}` : "keep", () =>
          addNoteTodo({ ticket: tickets.includes(ticket) ? ticket : "", text, kind: isTodoKind(td.kind) ? td.kind : "other", owner: td.owner === "other" ? "other" : "me", refs, runId, due: td.due ?? null }),
        );
        if (t.outcome === "merged") merged++;
        else if (!t.outcome) {
          open.push(t);
          added++;
        }
      }
      mark(batch);
      reviewed += batch.length;
    }
    if (added || merged) emitChange("todos");
    return { ok: failed < batches.length, reviewed, added, merged, batches: batches.length, ...(failed ? { error: t("{failed} of {n} parts failed", { failed, n: batches.length }) } : {}) };
  })()
    .catch((e): NoteTodosResult => {
      console.error("[note-todos]", errorMessage(e));
      return { ok: false, reviewed: 0, added: 0, batches: 0, error: errorMessage(e) };
    })
    .finally(() => {
      state.__zeffNoteTodos = null;
    });
  state.__zeffNoteTodos = run;
  return run;
}
