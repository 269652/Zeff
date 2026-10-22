import { aiChoice, runAi } from "@/lib/ai";
import { ABORTED, throwIfAborted, withAbort } from "@/lib/abort";
import { inThisAccount } from "@/db/accounts";
import { AI_PROVIDER_INFO } from "@/lib/ai/shared";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { collectBoard } from "./collect";
import { answerOpenQuestions } from "./questions";
import { BOARD_RESULT_SCHEMA, isAttention, TICKET_ACTION_TYPES, type BoardResult, type BoardTicket } from "./shared";
import { closeTodosOfDoneTickets, finishRun, getBoardSettings, lastGoodRun, reconcileTodos, startRun } from "./store";

/** What a run is doing right now — one at a time across the server (actions and the scheduler are separate module copies). */
const state = globalThis as { __zeffBoardRun?: { id: number; phase: "sync" | "jira" | "ai" | "saving" | "mailtodos" | "mails" | "notetodos" | "notes" | "documents" | "docrelations" | "knowledge" | "people" | "autoactions"; since: number; provider: string } | null };

/** The run going on in this server, and its step — null when none is. */
export const boardRunState = () => state.__zeffBoardRun ?? null;

/** Claude's answer, held to the tickets it was given: each once, known attention, todos with text. */
export function cleanResult(r: BoardResult, tickets: BoardTicket[]): BoardResult {
  const analyzed = new Set(tickets.filter((t) => t.analyzed).map((t) => t.key));
  const left = new Set(tickets.filter((t) => t.left).map((t) => t.key));
  const seen = new Set<string>();
  return {
    lede: String(r.lede ?? "").trim(),
    tickets: (r.tickets ?? [])
      .map((t) => ({ ...t, key: String(t.key ?? "").trim().toUpperCase() }))
      .filter((t) => analyzed.has(t.key) && !seen.has(t.key) && seen.add(t.key))
      .map((t) => ({
        key: t.key,
        attention: isAttention(t.attention) ? t.attention : "ready",
        lead: String(t.lead ?? "").trim(),
        summary: String(t.summary ?? "").trim(),
        happened: (t.happened ?? []).filter((h) => h?.what).slice(0, 8),
        todos: (t.todos ?? []).filter((d) => d?.text?.trim()),
        resolved: (t.resolved ?? []).filter((d) => Number.isInteger(d?.id)),
        flags: (t.flags ?? []).filter(Boolean).slice(0, 5),
        branchKnowledge: (t.branchKnowledge ?? [])
          .filter((b) => b && String(b.text ?? "").trim())
          .slice(0, 4)
          .map((b) => ({ kind: b.kind === "rule" ? ("rule" as const) : ("change" as const), text: String(b.text).trim().slice(0, 300), ...(/^(teams|jira-comment|mail):./.test(String(b.ref ?? "").trim()) ? { ref: String(b.ref).trim() } : {}) })),
        questions: (t.questions ?? [])
          .filter((x) => x && String(x.q ?? "").trim())
          .slice(0, 5)
          .map((x) => ({
            q: String(x.q).trim().slice(0, 200),
            ...(String(x.a ?? "").trim() ? { a: String(x.a).trim().slice(0, 1500) } : {}),
            ...(String(x.search ?? "").trim() ? { search: String(x.search).trim().slice(0, 120) } : {}),
          })),
        actions: (t.actions ?? [])
          .filter(
            (a) =>
              a &&
              (TICKET_ACTION_TYPES as readonly string[]).includes(a.type) &&
              String(a.label ?? "").trim() &&
              (a.type === "transition" ? !!a.to?.trim() : a.type === "assign" ? !!a.assignee?.trim() : !!a.comment?.trim()),
          )
          .slice(0, 3)
          .map((a) => ({
            type: a.type,
            label: String(a.label).trim().slice(0, 80),
            ...(a.to ? { to: String(a.to).trim() } : {}),
            ...(a.assignee ? { assignee: String(a.assignee).trim() } : {}),
            ...(a.comment ? { comment: String(a.comment).trim().slice(0, 8000) } : {}),
            why: String(a.why ?? "").trim().slice(0, 300),
          })),
      })),
    left: (r.left ?? []).map((l) => ({ key: String(l.key ?? "").trim().toUpperCase(), note: String(l.note ?? "").trim() })).filter((l) => left.has(l.key) && l.note),
  };
}

/**
 * Start a run in the background: read the tickets (with what Zeff knows), go through the AI
 * provider chosen on the Settings page (Claude Code or Copilot CLI), keep its answer and take in
 * its todos. Answers at once — the page follows the run.
 */
export function startBoardRun(opts: { syncJira?: boolean } = {}): { ok: boolean; message: string } {
  // Kept in the account it was started in — whichever is switched to while it runs.
  return inThisAccount(() => {
    if (state.__zeffBoardRun) return { ok: false, message: t("A briefing run is already running.") };
    const s = getBoardSettings();
    const ai = aiChoice();
    const provider = AI_PROVIDER_INFO[ai.provider].label;
    const id = startRun(s.jql, `${provider}${ai.model ? ` · ${ai.model}` : ""}`);
    const t0 = Date.now();
    state.__zeffBoardRun = { id, phase: opts.syncJira ? "sync" : "jira", since: t0, provider };
    // Stoppable (its button, the Sync menu): the sync, the AI, the step it's on — ended.
    const stop = new AbortController();
    stopState.__zeffBoardRunStop = stop;
    void withAbort(stop, async () => {
      // The Lage kept (ok): a later step stopped or failing doesn't make the run an error.
      let kept = false;
      try {
        // By hand: what the Auswerten settings say is synced first (Jira, Teams, the mails …) — only
        // when its last sync is older than set; a failed sync doesn't stop the run.
        if (opts.syncJira) {
          const { syncAndWait, syncOverview } = await import("@/lib/sync/registry");
          const { stepAvailable } = await import("@/plugins/state");
          const { getContextPrefs } = await import("./context-prefs");
          const { PRESYNC_ORDER } = await import("./context-prefs-shared");
          const pre = getContextPrefs().presync;
          const last = new Map(syncOverview().steps.map((s) => [s.key, s.lastAt]));
          const stale = (key: string) => !pre.numbers.maxAge || !last.get(key as never) || Date.now() - new Date(last.get(key as never)!).getTime() > pre.numbers.maxAge * 60000;
          for (const key of PRESYNC_ORDER) if (pre.sources[key] && stepAvailable(key) && stale(key)) await syncAndWait(key).catch(() => null);
          state.__zeffBoardRun = { id, phase: "jira", since: t0, provider };
        }
        const { tickets, prompt, doneLeft, fromCache } = await collectBoard(s.jql, lastGoodRun(id), { maxChars: ai.maxPrompt });
        if (!tickets.some((t) => t.analyzed)) {
          // No tickets: no Lage — the mails and WhatsApp messages are still gone through for todos (below).
          finishRun(id, { status: "ok", tickets, result: { lede: "No open tickets to brief on.", tickets: [], left: [] }, durationMs: Date.now() - t0 });
          kept = true;
        } else {
          state.__zeffBoardRun = { id, phase: "ai", since: t0, provider };
          const answer = await runAi<BoardResult>(prompt, BOARD_RESULT_SCHEMA, { task: "ticket-lage", maxBudgetUsd: 5, timeoutMs: 15 * 60000 });
          state.__zeffBoardRun = { id, phase: "saving", since: t0, provider };
          const result = cleanResult(answer.output, tickets);
          if (fromCache) result.lede = `⚠ Jira wasn't reachable (${fromCache}) — briefed from Zeff's last copy. ${result.lede}`;
          // Questions the context left open: answered from what the knowledge base has on them (looked up now, not given in the prompt).
          await answerOpenQuestions(result).catch((e) => console.error("[boards] answering the questions failed:", errorMessage(e)));
          reconcileTodos(result, id);
          // What the AI read about code changes and branch naming while it wrote the todos: kept as knowledge artifacts (tag branch-naming).
          try {
            (await import("@/lib/work/branch-knowledge")).keepFromBriefing(result.tickets);
          } catch (e) {
            console.error("[boards] keeping the branch knowledge failed:", errorMessage(e));
          }
          closeTodosOfDoneTickets(doneLeft);
          // Merge requests to open, asked for in words: their button (push → open MR), worked out from git.
          try {
            await (await import("./delivery-ops")).attachOpenMrOps();
            await (await import("./delivery-ops")).upgradeOpenMrOps();
            // The review comments a todo stands for: "Resolve" for each thread still open.
            await (await import("./comment-ops")).attachCommentOps();
            // Waiting ones to "Wartet auf andere", joint ones with their "when do you have time?" message.
            (await import("./todo-rules")).applyTodoRules();
          } catch {
            // without buttons, then
          }
          finishRun(id, { status: "ok", tickets, result, model: answer.model, costUsd: answer.costUsd, durationMs: Date.now() - t0 });
          kept = true;
        }
        // Then steps of their own (the Lage is there already; the run ends when they're done too):
        // the new mails and WhatsApp messages gone through for todos (a training, a deadline) — then
        // which mails each todo is about (picked by content, with more room for mails).
        const { syncAndWait } = await import("@/lib/sync/registry");
        state.__zeffBoardRun = { id, phase: "mailtodos", since: t0, provider };
        await syncAndWait("mailtodos");
        state.__zeffBoardRun = { id, phase: "mails", since: t0, provider };
        await syncAndWait("relations");
        // Google Keep's extensions (while they're on): the notes gone through for todos, then which
        // notes each todo is about.
        const { stepAvailable } = await import("@/plugins/state");
        if (stepAvailable("notetodos")) {
          state.__zeffBoardRun = { id, phase: "notetodos", since: t0, provider };
          await syncAndWait("notetodos");
        }
        if (stepAvailable("noterelations")) {
          state.__zeffBoardRun = { id, phase: "notes", since: t0, provider };
          await syncAndWait("noterelations");
        }
        // The Documents plugin's extensions (while they're on): the documents gone through for todos, then which
        // documents each todo is about.
        if (stepAvailable("doctodos")) {
          state.__zeffBoardRun = { id, phase: "documents", since: t0, provider };
          await syncAndWait("doctodos");
        }
        if (stepAvailable("docrelations")) {
          state.__zeffBoardRun = { id, phase: "docrelations", since: t0, provider };
          await syncAndWait("docrelations");
        }
        // The Knowledge plugin's extension: which knowledge pages each todo needs (only those that fit).
        if (stepAvailable("knowledgerel")) {
          state.__zeffBoardRun = { id, phase: "knowledge", since: t0, provider };
          await syncAndWait("knowledgerel");
        }
        // The People plugin: who the names in the todos are (aliases, profiles, merges) — before the actions, which name them.
        if (stepAvailable("peoplenorm")) {
          state.__zeffBoardRun = { id, phase: "people", since: t0, provider };
          await syncAndWait("peoplenorm");
        }
        // The Cases plugin: the case numbers in what came in (by rule), then the cases with new sources summed up (AI) — a
        // failure there doesn't stop the run.
        if ((await import("@/plugins/state")).isInstalled("cases")) {
          try {
            (await import("@/plugins/cases/detect")).detectCases();
            if ((await import("@/plugins/state")).isInstalled("llm")) await (await import("@/plugins/cases/compile")).compileCases();
            (await import("@/plugins/cases/payments")).attachPayments();
            // The bank: payments made settle their todos and cases; an instalment ten days late warns.
            const bank = await import("@/plugins/cases/bank");
            if ((await import("@/plugins/cases/bank-sync")).bankConnected()) await (await import("@/plugins/cases/bank-sync")).syncBank().catch((e) => console.error("[cases] the bank:", errorMessage(e)));
            if ((await import("@/plugins/state")).isInstalled("revolut")) (await import("@/plugins/revolut/statement")).importStatementDocuments();
            bank.matchPayments();
            bank.overdueWarnings(new Date().toISOString().slice(0, 10));
            // Your income as the knowledge read it off your statements (it compiles them as a source of its own).
            if ((await import("@/plugins/state")).isInstalled("finances")) await (await import("@/plugins/finances/income")).refreshIncome();
          } catch (e) {
            console.error("[cases] after the briefing:", errorMessage(e));
          }
        }
        throwIfAborted();
        // The duplicates the steps above may have left (and any from before): merged into the oldest, before the actions look at them.
        await syncAndWait("tododupes");
        // Last: the todos without a button get ready actions (with the mails related to them in their context).
        state.__zeffBoardRun = { id, phase: "autoactions", since: t0, provider };
        await syncAndWait("autoactions");
      } catch (e) {
        if (!kept) finishRun(id, { status: "error", error: stop.signal.aborted ? ABORTED : errorMessage(e), durationMs: Date.now() - t0 });
        else if (!stop.signal.aborted) console.error("[boards] a step after the Lage failed:", errorMessage(e));
      } finally {
        state.__zeffBoardRun = null;
        if (stopState.__zeffBoardRunStop === stop) stopState.__zeffBoardRunStop = null;
      }
    });
    return { ok: true, message: t("Briefing started.") };
  });
}

const stopState = globalThis as { __zeffBoardRunStop?: AbortController | null };

/** Stop the Ticket-Lage's run (and the step it's on). Whether one was running. */
export function stopBoardRun(): boolean {
  const c = stopState.__zeffBoardRunStop;
  if (!c) return false;
  c.abort();
  return true;
}
