/**
 * The LLM plugin: the one way Zeff asks an AI — a task (the Ticket-Lage, the mail steps, the
 * auto-actions …) through its backend (the Copilot CLI or the Claude CLI plugin, as set for the
 * task or by default), with your instructions and context in front of every prompt. Server only.
 */
import { aiChoice, getAppSettings, type AiAnswer } from "@/lib/ai";
import { AI_PROVIDER_INFO, type AiProvider } from "@/lib/ai/shared";
import { ValidationError } from "@/lib/errors";
import { runClaude } from "@/plugins/claude-cli/cli";
import { runCopilot } from "@/plugins/copilot-cli/cli";
import { isInstalled, providerAvailable } from "@/plugins/state";
import { getLlmSettings } from "./settings";
import { LLM_PREAMBLE_MAX, type LlmTaskId } from "./tasks";

/** Which backend and model a task runs with: its own (if that backend is installed), else the default. */
export function llmChoice(task: LlmTaskId): { provider: AiProvider; model: string } {
  const own = getLlmSettings().tasks[task];
  const app = getAppSettings();
  const provider: AiProvider = own?.provider && providerAvailable(own.provider) ? own.provider : aiChoice().provider;
  const fallback = provider === "copilot" ? app.copilotModel : app.claudeModel;
  return { provider, model: (own?.model && own.provider === provider ? own.model : "") || fallback };
}

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
  if (!isInstalled("llm")) return Promise.reject(new ValidationError("The LLM plugin is not installed (Menu → Plugins) — no AI tasks."));
  const choice = llmChoice(task);
  const provider = opts.provider ?? choice.provider;
  if (!providerAvailable(provider)) return Promise.reject(new ValidationError(`${AI_PROVIDER_INFO[provider].label}: the plugin is not installed (Menu → Plugins).`));
  const app = getAppSettings();
  const model = (opts.provider && opts.provider !== choice.provider ? (provider === "copilot" ? app.copilotModel : app.claudeModel) : choice.model) || undefined;
  const preamble = llmPreamble();
  // Last: what comes last weighs most — the user's word over the task's own rules.
  const full = preamble ? `${prompt}\n\n---\n\n${preamble}` : prompt;
  return provider === "copilot"
    ? runCopilot<T>(full, schema, { model, timeoutMs: opts.timeoutMs })
    : runClaude<T>(full, schema, { model, timeoutMs: opts.timeoutMs, maxBudgetUsd: opts.maxBudgetUsd });
}
