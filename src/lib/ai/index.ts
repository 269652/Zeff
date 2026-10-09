import { getDb, schema } from "@/db";
import type { AppSettings } from "@/db/schema";
import { findClaudeCli, runClaude, type AiAnswer } from "./claude";
import { findCopilotCli, runCopilot } from "./copilot";
import { AI_PROVIDER_INFO, AI_PROVIDERS, type AiProvider } from "./shared";

export type { AiAnswer };

const { appSettings } = schema;

export function getAppSettings(): AppSettings {
  const db = getDb();
  return db.select().from(appSettings).limit(1).get() ?? db.insert(appSettings).values({ id: 1 }).returning().get();
}

export function updateAppSettings(patch: Partial<Omit<AppSettings, "id">>): AppSettings {
  getAppSettings(); // ensure the row exists
  return getDb().update(appSettings).set(patch).returning().get();
}

/** Each provider and where its CLI was found (null: not installed, as far as Zeff can see). */
export function aiProviders(): { id: AiProvider; label: string; found: string | null }[] {
  return AI_PROVIDERS.map((id) => ({
    id,
    label: AI_PROVIDER_INFO[id].label,
    found: id === "claude" ? findClaudeCli() : (findCopilotCli()?.where ?? null),
  }));
}

/** The chosen provider, its model ("" = the CLI's own), and the longest prompt it takes (null: no limit). */
export function aiChoice(): { provider: AiProvider; model: string; maxPrompt: number | null } {
  const s = getAppSettings();
  const provider: AiProvider = s.aiProvider === "copilot" ? "copilot" : "claude";
  return { provider, model: provider === "copilot" ? s.copilotModel : s.claudeModel, maxPrompt: null };
}

/** A prompt answered as JSON matching `schema`, by the chosen provider (or the one given). */
export function runAi<T>(prompt: string, schemaOut: object, opts: { provider?: AiProvider; timeoutMs?: number; maxBudgetUsd?: number } = {}): Promise<AiAnswer<T>> {
  const choice = aiChoice();
  const provider = opts.provider ?? choice.provider;
  const s = getAppSettings();
  const model = (provider === "copilot" ? s.copilotModel : s.claudeModel) || undefined;
  return provider === "copilot"
    ? runCopilot<T>(prompt, schemaOut, { model, timeoutMs: opts.timeoutMs })
    : runClaude<T>(prompt, schemaOut, { model, timeoutMs: opts.timeoutMs, maxBudgetUsd: opts.maxBudgetUsd });
}
