"use server";

import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import type { ActionState } from "@/app/action-helpers";

/** Knowledge: its server actions (each answers an ActionState unless it says otherwise). */

async function knowledgeOn(): Promise<string | null> {
  return (await import("@/plugins/state")).isInstalled("knowledge") ? null : t("Knowledge is not installed (Menu → Plugins).");
}

/** A question to the knowledge server, with the conversation so far — its answer and sources. */
export async function askKnowledgeAction(question: string, history: { role: "user" | "assistant"; text: string }[]): Promise<{ ok: true; answer: import("@/plugins/knowledge/shared").KnowledgeAnswer } | { ok: false; error: string }> {
  try {
    const off = await knowledgeOn();
    if (off) return { ok: false, error: off };
    const q = String(question ?? "").trim();
    if (!q) return { ok: false, error: t("No question.") };
    const turns = (Array.isArray(history) ? history : []).slice(-8).map((h) => ({ role: h.role === "assistant" ? ("assistant" as const) : ("user" as const), text: String(h.text ?? "").slice(0, 4000) }));
    // A question about numbers and dates in your own data is answered from it (Structured questions) — else the knowledge's.
    const fromData = await (await import("@/plugins/questions/ask")).chatAnswer(q, turns);
    if (fromData) return { ok: true, answer: fromData };
    const { knowledgeAsk } = await import("@/plugins/knowledge/client");
    return { ok: true, answer: await knowledgeAsk(q, turns) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** The knowledge relevant to a todo (its words, its ticket and the ticket's summary) — pages and entities. */
export async function todoKnowledgeAction(todoId: number): Promise<{ ok: true; pages: import("@/plugins/knowledge/shared").KnowledgePage[]; entities: import("@/plugins/knowledge/shared").KnowledgeEntity[] } | { ok: false; error: string }> {
  try {
    const off = await knowledgeOn();
    if (off) return { ok: false, error: off };
    const { getTodo } = await import("@/lib/boards/store");
    const { getJiraTicket } = await import("@/lib/jira/store");
    const todo = getTodo(Number(todoId));
    if (!todo) return { ok: false, error: t("That todo doesn't exist.") };
    const summary = todo.ticket ? (getJiraTicket(todo.ticket)?.summary ?? "") : "";
    const { knowledgeRelated } = await import("@/plugins/knowledge/client");
    const r = await knowledgeRelated([todo.text, summary].filter(Boolean).join(" — "), todo.ticket || null, 5);
    return { ok: true, pages: r.pages, entities: r.entities };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** The knowledge server: read Confluence now, and compile what's new. */
export async function knowledgeSyncAction(): Promise<ActionState> {
  try {
    const off = await knowledgeOn();
    if (off) return { ok: false, error: off };
    await (await import("@/plugins/knowledge/client")).knowledgeSync();
    return { ok: true, message: t("The knowledge server is reading Confluence and compiling what's new — that takes a while.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
