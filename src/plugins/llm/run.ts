/**
 * The LLM plugin: the one way Zeff asks an AI — a task (the Ticket-Lage, the mail steps, the
 * auto-actions …) through its backend (the Copilot, Claude or Codex CLI plugin, as set for the
 * task or by default), with your instructions and context in front of every prompt. Server only.
 */
import { aiChoice, defaultModelOf, type AiAnswer } from "@/lib/ai";
import { promptText } from "@/lib/prompts";
import { AI_PROVIDER_INFO, type AiProvider } from "@/lib/ai/shared";
import { onAbort, throwIfAborted } from "@/lib/abort";
import { answerKey, createGate, withNoJsonRetry, type Gate } from "@/lib/ai/guard";
import { memoGet, memoPrune, memoSet } from "@/lib/ai/memo";
import { ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { runClaude } from "@/plugins/claude-cli/cli";
import { runCodex } from "@/plugins/codex-cli/cli";
import { liveDriverFor } from "@/lib/work/live-driver";
import { claudeSessionSettings } from "@/lib/work/store";
import { runCopilot } from "@/plugins/copilot-cli/cli";
import { isInstalled, providerAvailable } from "@/plugins/state";
import { recordUsage } from "@/lib/ai/usage";
import { countRedactions, recordReceipt } from "@/lib/ai/receipts";
import { guardPrompt } from "@/lib/boundaries";
import { getLlmSettings } from "./settings";
import { localAiConfig } from "@/plugins/local-ai/config";
import { runLocal } from "@/plugins/local-ai/client";

/** Whether a prompt with secret lines goes whole to the local AI (its plugin installed, and set so on its page). */
const keepsSecretsLocal = (): boolean => providerAvailable("local") && isInstalled("local-ai") && localAiConfig().secretLocal;
import { IDEMPOTENT_TASKS, LLM_PREAMBLE_MAX, type LlmTaskId } from "./tasks";

/** At most this many CLIs at once, from every job and loop together. */
export const LLM_CONCURRENCY = 3;
/** An idempotent task's answer is remembered this long (lib/ai/memo: in the account's database, across restarts). */
const MEMO_MAX_AGE_MS = 7 * 864e5;

// One gate for the whole server (its module copies share it).
const shared = globalThis as { __zeffLlmGate2?: Gate; __zeffLlmPruned?: number };
const gate = (): Gate => (shared.__zeffLlmGate2 ??= createGate(LLM_CONCURRENCY));
/** An idempotent answer kept (the old ones dropped, at most once an hour). */
function remember(task: string, key: string, answer: AiAnswer<unknown>): void {
  try {
    memoSet(`llm:${task}`, key, key, answer);
    if (Date.now() - (shared.__zeffLlmPruned ?? 0) > 36e5) {
      shared.__zeffLlmPruned = Date.now();
      memoPrune("llm:", MEMO_MAX_AGE_MS);
    }
  } catch (e) {
    console.warn("[llm] the answer could not be kept", e);
  }
}
const recall = <T>(task: string, key: string): AiAnswer<T> | undefined => {
  try {
    return memoGet<AiAnswer<T>>(`llm:${task}`, key, key, MEMO_MAX_AGE_MS);
  } catch {
    return undefined;
  }
};

/** Which backend and model a task runs with: its own (if that backend is installed), else the default. */
export function llmChoice(task: LlmTaskId): { provider: AiProvider; model: string } {
  const own = getLlmSettings().tasks[task];
  let provider: AiProvider = own?.provider && providerAvailable(own.provider) ? own.provider : aiChoice().provider;
  // ChatGPT's workers are live sessions only: without those (Code settings → Live sessions) the first other backend installed.
  if (task === "worker" && provider === "codex" && !liveWorkersOn("codex")) provider = (["claude", "copilot"] as const).find((p) => providerAvailable(p)) ?? "copilot";
  // The local AI answers prompts — it doesn't work in a repo: a worker goes to a CLI.
  if (task === "worker" && provider === "local") provider = (["claude", "copilot", "codex"] as const).find((p) => providerAvailable(p)) ?? "copilot";
  return { provider, model: (own?.model && own.provider === provider ? own.model : "") || defaultModelOf(provider) };
}

/** Workers of a backend that only runs as live sessions (ChatGPT's): possible while Work's Live sessions are on and its plugin is installed. */
export const liveWorkersOn = (provider: AiProvider): boolean => providerAvailable(provider) && claudeSessionSettings().live && !!liveDriverFor(provider);

/** Your instructions and context, as they go in front of a prompt (or to a worker / agent) — "" when there are none. */
export function llmPreamble(): string {
  const s = getLlmSettings();
  // (Pages in System → Prompts once they're made.)
  const instructions = promptText("llm-instructions", "", s.instructions);
  const context = promptText("llm-context", "", s.context);
  const parts = [
    instructions.trim() && `## Die allgemeinen Anweisungen des Nutzers (gelten für jede Aufgabe — sie gehen allen anderen Regeln oben vor)\n${instructions.trim()}`,
    context.trim() && `## Kontext über den Nutzer\n${context.trim()}`,
  ].filter(Boolean) as string[];
  const text = parts.join("\n\n");
  return text.length > LLM_PREAMBLE_MAX ? `${text.slice(0, LLM_PREAMBLE_MAX - 1)}…` : text;
}

/**
 * A task done by the AI: the prompt (with your instructions and context in front) answered as
 * JSON matching `schema`, by the task's backend. Rejects when the LLM plugin or the backend isn't
 * installed. Runs through a gate (three at a time); a Copilot or Codex answer without JSON is asked
 * for once more; an idempotent task (tasks.ts) repeated with the same input is answered from memory
 * (`fresh`: not).
 */
export function llm<T>(task: LlmTaskId, prompt: string, schema: object, opts: { provider?: AiProvider; timeoutMs?: number; maxBudgetUsd?: number; fresh?: boolean; urgent?: boolean } = {}): Promise<AiAnswer<T>> {
  if (!isInstalled("llm")) return Promise.reject(new ValidationError(t("The LLM plugin is not installed (Menu → Plugins) — no AI tasks.")));
  const choice = llmChoice(task);
  let provider = opts.provider ?? choice.provider;
  if (!providerAvailable(provider)) return Promise.reject(new ValidationError(t("{provider}: the plugin is not installed (Menu → Plugins).", { provider: AI_PROVIDER_INFO[provider].label })));
  let model = (opts.provider && opts.provider !== choice.provider ? defaultModelOf(provider) : choice.model) || undefined;
  const preamble = llmPreamble();
  // Last: what comes last weighs most — the user's word over the task's own rules.
  // What is marked secret never goes out (lib/boundaries): its lines are left out of the prompt.
  const raw = preamble ? `${prompt}\n\n---\n\n${preamble}` : prompt;
  let full = guardPrompt(raw);
  let redacted = countRedactions(raw, full);
  // Secret lines in it, and a local AI that may read them (its page: "secret only to the local AI"): the whole prompt goes
  // there — to this computer — instead of to a cloud AI without them.
  if (full !== raw && provider !== "local" && keepsSecretsLocal()) {
    provider = "local";
    model = defaultModelOf("local") || undefined;
    full = raw;
    redacted = 0;
  }
  // Only Claude takes a budget.
  if (opts.maxBudgetUsd !== undefined && provider !== "claude") console.warn(`[llm] ${task}: maxBudgetUsd is ignored by ${provider}.`);
  // Each time it goes out (a second try too): a receipt of what went (lib/ai/receipts.ts — Privacy → What went to the AI).
  const attempt = () => (recordReceipt({ task, provider, model, text: full, redacted }), send());
  const send = () =>
    provider === "local"
      ? runLocal<T>(full, schema, { model, timeoutMs: opts.timeoutMs })
      : provider === "copilot"
      ? runCopilot<T>(full, schema, { model, timeoutMs: opts.timeoutMs })
      : provider === "codex"
        ? runCodex<T>(full, schema, { model, timeoutMs: opts.timeoutMs })
        : runClaude<T>(full, schema, { model, timeoutMs: opts.timeoutMs, maxBudgetUsd: opts.maxBudgetUsd });
  const key = IDEMPOTENT_TASKS.has(task) && !opts.fresh ? answerKey([task, provider, model ?? "", schema, full]) : null;
  const hit = key ? recall<T>(task, key) : undefined;
  if (hit) return Promise.resolve(hit);
  // Stopped while waiting for a slot: out of the line.
  const stop = new AbortController();
  const off = onAbort(() => stop.abort());
  return gate()
    .run(() => withNoJsonRetry(provider, attempt, () => throwIfAborted()), stop.signal, { first: !!opts.urgent })
    .then((answer) => {
      if (key) remember(task, key, answer);
      recordUsage(task, provider, model, answer);
      return answer;
    })
    .finally(off);
}
