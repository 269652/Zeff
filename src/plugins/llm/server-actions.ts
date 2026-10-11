"use server";

import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { revalidateAll, str, type ActionState } from "@/app/action-helpers";

/** Settings (app-wide: the AI provider analyses run through) — its server actions (each answers an ActionState unless it says otherwise). */

/** The AI provider (Claude Code, Copilot or Codex CLI) and each one's model. */
export async function saveAiSettingsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { isAiProvider, isClaudeModel, AI_PROVIDER_INFO } = await import("@/lib/ai/shared");
  const provider = str(fd, "aiProvider") ?? "";
  if (!isAiProvider(provider)) return { ok: false, error: t("Unknown provider.") };
  const claudeModel = str(fd, "claudeModel") ?? "";
  if (!isClaudeModel(claudeModel)) return { ok: false, error: t("Unknown Claude model.") };
  const copilotModel = (str(fd, "copilotModel") ?? "").trim();
  if (copilotModel && !/^[\w.:-]{2,60}$/.test(copilotModel)) return { ok: false, error: t("A Copilot model name, like gpt-5.4 or claude-haiku-4.5.") };
  const { getAppSettings, updateAppSettings } = await import("@/lib/ai");
  // ChatGPT's model: from its card (when the plugin is installed), else as it was.
  const codexModel = fd.has("codexModel") ? (str(fd, "codexModel") ?? "").trim() : getAppSettings().codexModel;
  if (codexModel && !/^[\w.:-]{2,60}$/.test(codexModel)) return { ok: false, error: t("A ChatGPT model name, like gpt-5.5.") };
  updateAppSettings({ aiProvider: provider, claudeModel, copilotModel, codexModel });
  revalidateAll();
  return { ok: true, message: t("Analyses now run through the {provider}.", { provider: AI_PROVIDER_INFO[provider].label }) };
}

/** A short test of a provider: is it there and signed in? Answers with its time and model. */
export async function testAiAction(provider: string): Promise<ActionState> {
  try {
    const { isAiProvider } = await import("@/lib/ai/shared");
    if (!isAiProvider(provider)) return { ok: false, error: t("Unknown provider.") };
    const { runAi } = await import("@/lib/ai");
    const t0 = Date.now();
    const r = await runAi<{ ok: boolean }>("Antworte mit ok = true.", { type: "object", required: ["ok"], properties: { ok: { type: "boolean" } } }, { provider, timeoutMs: 120000, maxBudgetUsd: 0.2 });
    if (r.output?.ok !== true) return { ok: false, error: t("It answered, but not as asked.") };
    const cost = r.costUsd != null ? ` · ≈ ${r.costUsd.toFixed(3)} $` : "";
    return { ok: true, message: `${t("Works: answered in {s} s", { s: Math.round((Date.now() - t0) / 1000) })}${r.model ? ` · ${r.model}` : ""}${cost}.` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** The LLM plugin's settings: your instructions and context, each task's backend and model. */
export async function saveLlmSettingsAction(v: { instructions: string; context: string; tasks: Record<string, { provider?: string; model?: string }> }): Promise<ActionState> {
  try {
    if (!(await import("@/plugins/state")).isInstalled("llm")) return { ok: false, error: t("The LLM plugin is not installed (Menu → Plugins).") };
    const { saveLlmSettings } = await import("@/plugins/llm/settings");
    saveLlmSettings({
      instructions: String(v?.instructions ?? ""),
      context: String(v?.context ?? ""),
      tasks: Object.fromEntries(Object.entries(v?.tasks ?? {}).map(([k, x]) => [k, { provider: x?.provider === "copilot" || x?.provider === "claude" || x?.provider === "codex" ? x.provider : "", model: String(x?.model ?? "") }])),
    });
    revalidatePath("/llm");
    return { ok: true, message: t("LLM settings saved — they apply from the next task on.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
