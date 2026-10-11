import { eq } from "drizzle-orm";
import { throwIfAborted } from "@/lib/abort";
import { getDb, schema } from "@/db";
import { aiChoice, runAi } from "@/lib/ai";
import { extraBlock, getContextPrefs } from "@/lib/boards/context-prefs";
import { listTodos } from "@/lib/boards/store";
import type { TodoView } from "@/lib/boards/shared";
import { errorMessage } from "@/lib/errors";
import { emitChange } from "@/lib/events";
import { getJiraTicket } from "@/lib/jira/store";
import { getLanguage, t } from "@/lib/i18n/server";
import { COPILOT_MAX_PROMPT } from "@/plugins/copilot-cli/cli";
import { entitiesFor, parseTodoKnowledge, type KnowledgeEntity, type KnowledgePage, type TodoKnowledge } from "./shared";

export type { TodoKnowledge } from "./shared";


const SCHEMA = {
  type: "object",
  properties: {
    todos: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "integer" },
          pages: {
            type: "array",
            items: { type: "object", properties: { id: { type: "string" }, why: { type: "string" } }, required: ["id", "why"] },
          },
          entities: { type: "array", items: { type: "integer" } },
        },
        required: ["id", "pages", "entities"],
      },
    },
  },
  required: ["todos"],
};
type Answer = { todos?: { id?: number; pages?: ({ id?: string; why?: string } | string)[]; entities?: number[] }[] };

const INSTRUCTIONS = `Du ordnest meinen offenen Todos Wissen zu. Zu jedem Todo (Nummer in eckigen Klammern, sein Text, ggf. sein Ticket) stehen Kandidaten aus der Wissensbasis — Seiten [p:…] mit Titel, Bereich und der gefundenen Stelle, Begriffe [e:…] mit ihrer Erklärung —, gefunden über eine Volltextsuche nach den Wörtern des Todos. Viele davon passen nur zufällig (ein gleiches Wort).

Wähle je Todo NUR die Kandidaten, die mir beim Erledigen dieses Todos wirklich helfen: es geht um dieselbe Sache, dasselbe System, denselben Ablauf, dieselbe Person — nicht bloß ein gemeinsames Wort. Lieber keine als eine unpassende. Für persönliche Dinge (Freunde, Termine, Behörden, Einkäufe) passt Firmenwissen fast nie. Gib zu jedem Todo die gewählten Seiten-Kennungen (ohne „p:“) und Begriff-Nummern (ohne „e:“) an — leere Listen, wenn nichts passt. Zu jeder gewählten Seite ein „why“: EIN kurzer Satz (höchstens 90 Zeichen), was mir diese Seite für das Todo bringt — konkret, z. B. „Checkliste der Unterlagen für den Ersttermin“ oder „Wie der Login auf CMS 11 eingerichtet wird“; nicht „passt zum Thema“ und keine Wiederholung des Titels.`;

const LANGUAGE_NAMES = { de: "Deutsch", en: "Englisch", es: "Spanisch" } as const;

const state = globalThis as unknown as { __zeffKnowledgeRelations?: Promise<KnowledgeRelationResult> | null };
export type KnowledgeRelationResult = { ok: boolean; todos: number; assigned: number; error?: string };


const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s).replace(/\s+/g, " ");

/**
 * The Wissens-Zuordnung (after the Ticket-Lage): for each open todo that's new or changed since
 * its last one, the knowledge server's full-text candidates — and the AI keeps only those that
 * really fit. Stored on the todo: "Show knowledge" shows just them.
 */
export function relateKnowledge(): Promise<KnowledgeRelationResult> {
  if (state.__zeffKnowledgeRelations) return state.__zeffKnowledgeRelations;
  const run = (async (): Promise<KnowledgeRelationResult> => {
    const cp = getContextPrefs().knowledge;
    const db = getDb();
    const stored = new Map(db.select({ id: schema.todos.id, knowledge: schema.todos.knowledge }).from(schema.todos).all().map((r) => [r.id, parseTodoKnowledge(r.knowledge)]));
    // New or changed since their last assignment — the newest first, at most as many as set.
    const due = listTodos({ status: "open" })
      .filter((t) => {
        const k = stored.get(t.id);
        // (Picked before pages came with a "why": once more, to get it.)
        return !k || k.at < t.updatedAt || k.pages.some((p) => p.why === undefined);
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, cp.numbers.maxTodos);
    if (!due.length) return { ok: true, todos: 0, assigned: 0 };

    const { knowledgeRelated } = await import("./client");
    // Not knowledge for a todo: the todo itself, its own ticket (Show context has it) and the other
    // open todos (they're on the board) — the knowledge holds all of them, so they'd always match.
    const openTodos = new Set(listTodos({ status: "open" }).map((t) => `zeff:todo:${t.id}`));
    const notKnowledge = (t: TodoView, p: KnowledgePage) => p.id === `zeff:todo:${t.id}` || openTodos.has(p.id) || (!!t.ticket && p.id === `zeff:jira:${t.ticket}`);
    const candidates = new Map<number, { pages: KnowledgePage[]; entities: KnowledgeEntity[] }>();
    for (const t of due) {
      const summary = t.ticket ? (getJiraTicket(t.ticket)?.summary ?? "") : "";
      const r = await knowledgeRelated([t.text, summary].filter(Boolean).join(" — "), t.ticket || null, cp.numbers.candidates + 4).catch(() => null);
      const pages = (r?.pages ?? []).filter((p) => !notKnowledge(t, p)).slice(0, cp.numbers.candidates);
      candidates.set(t.id, { pages, entities: entitiesFor(r?.entities ?? [], []) });
    }
    const now = new Date().toISOString();
    const save = (t: TodoView, pages: KnowledgePage[], entities: KnowledgeEntity[]) =>
      db.update(schema.todos).set({ knowledge: JSON.stringify({ at: now, pages, entities } satisfies TodoKnowledge) }).where(eq(schema.todos.id, t.id)).run();
    // No candidates at all: nothing to pick — saved as none (until it changes).
    const withCandidates = due.filter((t) => {
      const c = candidates.get(t.id)!;
      if (c.pages.length || c.entities.length) return true;
      save(t, [], []);
      return false;
    });

    const block = (t: TodoView) => {
      const c = candidates.get(t.id)!;
      return [
        `## [${t.id}] ${t.text}${t.ticket ? ` (Ticket ${t.ticket}${getJiraTicket(t.ticket)?.summary ? ` — ${clip(getJiraTicket(t.ticket)!.summary, 120)}` : ""})` : ""}`,
        ...c.pages.map((p) => `- [p:${p.id}] „${clip(p.title, 120)}“ (${p.space}): ${clip(p.summary || p.snippet, 300)}`),
        ...c.entities.map((e) => `- [e:${e.id}] ${e.name} (${e.type}): ${clip(e.summary, 200)}`),
      ].join("\n");
    };
    const limit = aiChoice().provider === "copilot" ? COPILOT_MAX_PROMPT - 5000 : 3 * (COPILOT_MAX_PROMPT - 5000);
    const batches: TodoView[][] = [];
    let size = 0;
    for (const t of withCandidates) {
      const n = block(t).length + 2;
      if (!batches.length || size + n > limit || batches[batches.length - 1].length >= 8) {
        batches.push([]);
        size = 0;
      }
      batches[batches.length - 1].push(t);
      size += n;
    }

    let assigned = 0;
    let failed = 0;
    for (const batch of batches) {
      throwIfAborted();
      const prompt = `${INSTRUCTIONS} Schreib die „why“-Sätze auf ${LANGUAGE_NAMES[getLanguage()]}.${extraBlock("knowledge")}\n\n${batch.map(block).join("\n\n")}`;
      const answer = await runAi<Answer>(prompt, SCHEMA, { task: "knowledge-relations", timeoutMs: 6 * 60000, maxBudgetUsd: 0.5 }).catch((e) => {
        console.error("[knowledge-relations]", errorMessage(e));
        failed++;
        return null;
      });
      if (!answer) continue;
      const picked = new Map((answer.output?.todos ?? []).map((x) => [Number(x.id), x]));
      for (const t of batch) {
        const c = candidates.get(t.id)!;
        const p = picked.get(t.id);
        const why = new Map((p?.pages ?? []).map((x) => (typeof x === "string" ? [x, ""] : [String(x.id ?? ""), String(x.why ?? "").trim()])));
        const pages = c.pages.filter((x) => why.has(String(x.id))).map((x) => ({ ...x, why: why.get(String(x.id)) ?? "" }));
        const entities = c.entities.filter((x) => (p?.entities ?? []).map(Number).includes(x.id));
        save(t, pages, entities);
        if (pages.length || entities.length) assigned++;
      }
    }
    emitChange("todos");
    return failed && failed === batches.length ? { ok: false, todos: due.length, assigned, error: t("The AI didn't answer.") } : { ok: true, todos: due.length, assigned };
  })();
  state.__zeffKnowledgeRelations = run;
  void run.finally(() => {
    state.__zeffKnowledgeRelations = null;
  });
  return run;
}
