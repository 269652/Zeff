import { getAppSettings, updateAppSettings } from "@/lib/ai";
import { ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { EMPTY_LLM_SETTINGS, isLlmTask, type LlmSettings, type LlmTaskSetting } from "./tasks";

/** The LLM plugin's settings: instructions, context, each task's backend and model. */
export function getLlmSettings(): LlmSettings {
  try {
    const v = JSON.parse(getAppSettings().llmSettings || "{}") as Partial<LlmSettings>;
    const tasks = Object.fromEntries(Object.entries(v.tasks ?? {}).filter(([k]) => isLlmTask(k))) as LlmSettings["tasks"];
    return { instructions: String(v.instructions ?? ""), context: String(v.context ?? ""), tasks };
  } catch {
    return EMPTY_LLM_SETTINGS;
  }
}

export function saveLlmSettings(v: { instructions: string; context: string; tasks: Record<string, LlmTaskSetting> }): LlmSettings {
  const instructions = String(v.instructions ?? "").trim();
  const context = String(v.context ?? "").trim();
  if (instructions.length + context.length > 8000) throw new ValidationError(t("Instructions and context: at most 8000 characters together."));
  const tasks: LlmSettings["tasks"] = {};
  for (const [id, t] of Object.entries(v.tasks ?? {})) {
    if (!isLlmTask(id)) continue;
    const provider = t?.provider === "copilot" || t?.provider === "claude" ? t.provider : "";
    const model = String(t?.model ?? "").trim().slice(0, 80);
    if (provider || model) tasks[id] = { provider, model };
  }
  updateAppSettings({ llmSettings: JSON.stringify({ instructions, context, tasks }) });
  return getLlmSettings();
}
