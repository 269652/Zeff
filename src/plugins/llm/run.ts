/**
 * The LLM plugin: the one way Zeff asks an AI — a task (the Ticket-Lage, the mail steps, the
 * auto-actions …) through its backend (the Copilot, Claude or Codex CLI plugin, as set for the
 * task or by default), with your instructions and context in front of every prompt. Server only.
 */
import { aiChoice, defaultModelOf, type AiAnswer } from "@/lib/ai";
import { AI_PROVIDER_INFO, type AiProvider } from "@/lib/ai/shared";
import { ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { runClaude } from "@/plugins/claude-cli/cli";
import { runCodex } from "@/plugins/codex-cli/cli";
import { liveDriverFor } from "@/lib/work/live-driver";
import { claudeSessionSettings } from "@/lib/work/store";
import { runCopilot } from "@/plugins/copilot-cli/cli";
import { isInstalled, providerAvailable } from "@/plugins/state";
import { getLlmSettings } from "./settings";
import { LLM_PREAMBLE_MAX, type LlmTaskId } from "./tasks";

/** Which backend and model a task runs with: its own (if that backend is installed), else the default. */
export function llmChoice(task: LlmTaskId): { provider: AiProvider; model: string } {
  const own = getLlmSettings().tasks[task];
  let provider: AiProvider = own?.provider && providerAvailable(own.provider) ? own.provider : aiChoice().provider;
  // ChatGPT's workers are live sessions only: without those (Work settings → Live sessions) the first other backend installed.
  if (task === "worker" && provider === "codex" && !liveWorkersOn("codex")) provider = (["claude", "copilot"] as const).find((p) => providerAvailable(p)) ?? "copilot";
  return { provider, model: (own?.model && own.provider === provider ? own.model : "") || defaultModelOf(provider) };
}

/** Workers of a backend that only runs as live sessions (ChatGPT's): possible while Work's Live sessions are on and its plugin is installed. */
export const liveWorkersOn = (provider: AiProvider): boolean => providerAvailable(provider) && claudeSessionSettings().live && !!liveDriverFor(provider);

/** Your instructions and context, as they go in front of a prompt (or to a worker / agent) — "" when there are none. */
export function llmPreamble(): string {
  const s = getLlmSettings();
  const parts = [
    s.instructions.trim() && `## Die allgemeinen Anweisungen des Nutzers (gelten für jede Aufgabe — sie gehen allen anderen Regeln oben vor)\n${s.instructions.trim()}`,
    s.context.trim() && `## Kontext über den Nutzer\n${s.context.trim()}`,
  ].filter(Boolean) as string[];
  const text = parts.join("\n\n");
  return text.length > LLM_PREAMBLE_MAX ? `${text.slice(0, LLM_PREAMBLE_MAX - 1)}…` : text;
}

/**
 * A task done by the AI: the prompt (with your instructions and context in front) answered as
 * JSON matching `schema`, by the task's backend. Rejects when the LLM plugin or the backend isn't
 * installed.
 */
export function llm<T>(task: LlmTaskId, prompt: string, schema: object, opts: { provider?: AiProvider; timeoutMs?: number; maxBudgetUsd?: number } = {}): Promise<AiAnswer<T>> {
  if (!isInstalled("llm")) return Promise.reject(new ValidationError(t("The LLM plugin is not installed (Menu → Plugins) — no AI tasks.")));
  const choice = llmChoice(task);
  const provider = opts.provider ?? choice.provider;
  if (!providerAvailable(provider)) return Promise.reject(new ValidationError(t("{provider}: the plugin is not installed (Menu → Plugins).", { provider: AI_PROVIDER_INFO[provider].label })));
  const model = (opts.provider && opts.provider !== choice.provider ? defaultModelOf(provider) : choice.model) || undefined;
  const preamble = llmPreamble();
  // Last: what comes last weighs most — the user's word over the task's own rules.
  const full = preamble ? `${prompt}\n\n---\n\n${preamble}` : prompt;
  return provider === "copilot"
    ? runCopilot<T>(full, schema, { model, timeoutMs: opts.timeoutMs })
    : provider === "codex"
      ? runCodex<T>(full, schema, { model, timeoutMs: opts.timeoutMs })
      : runClaude<T>(full, schema, { model, timeoutMs: opts.timeoutMs, maxBudgetUsd: opts.maxBudgetUsd });
}
