import { getDb, schema } from "@/db";
import type { AppSettings } from "@/db/schema";
import { findClaudeCli } from "@/plugins/claude-cli/cli";
import { findCodexCli } from "@/plugins/codex-cli/cli";
import { findCopilotCli } from "@/plugins/copilot-cli/cli";
import { localAiConfig } from "@/plugins/local-ai/config";
import type { LlmTaskId } from "@/plugins/llm/tasks";
import { AI_PROVIDER_INFO, AI_PROVIDERS, type AiAnswer, type AiProvider } from "./shared";
import { providerAvailable } from "@/plugins/state";

export type { AiAnswer };

const { appSettings } = schema;

export function getAppSettings(): AppSettings {
  const db = getDb();
  const row = db.select().from(appSettings).limit(1).get();
  if (row) return row;
  // Several processes may get here at once on a fresh database (next build's workers): one insert wins.
  db.insert(appSettings).values({ id: 1, claudeModel: "sonnet", codexModel: "gpt-6-luna" }).onConflictDoNothing().run();
  return db.select().from(appSettings).limit(1).get()!;
}

export function updateAppSettings(patch: Partial<Omit<AppSettings, "id">>): AppSettings {
  getAppSettings(); // ensure the row exists
  return getDb().update(appSettings).set(patch).returning().get();
}

/** Each provider whose plugin is installed, and where its CLI was found (null: not on this machine, as far as Zeff can see). */
export function aiProviders(): { id: AiProvider; label: string; found: string | null }[] {
  return AI_PROVIDERS.filter((id) => providerAvailable(id)).map((id) => ({
    id,
    label: AI_PROVIDER_INFO[id].label,
    // (The local AI: its address — whether it answers is the settings page's check.)
    found: id === "claude" ? findClaudeCli() : id === "codex" ? (findCodexCli()?.where ?? null) : id === "local" ? localAiUrl() : (findCopilotCli()?.where ?? null),
  }));
}

/** The chosen provider, its model ("" = the CLI's own), and the longest prompt it takes (null: no limit). */
export function aiChoice(): { provider: AiProvider; model: string; maxPrompt: number | null } {
  const s = getAppSettings();
  // The one chosen — while its plugin is installed; else the first installed (Copilot by default).
  const chosen = AI_PROVIDERS.find((p) => p === s.aiProvider);
  const provider: AiProvider = chosen && providerAvailable(chosen) ? chosen : (AI_PROVIDERS.find((p) => providerAvailable(p)) ?? "copilot");
  return { provider, model: defaultModelOf(provider, s), maxPrompt: null };
}

/** A provider's own default model, as set on the LLM page ("" = its CLI's). */
export const defaultModelOf = (provider: AiProvider, s: AppSettings = getAppSettings()): string =>
  provider === "copilot" ? s.copilotModel : provider === "codex" ? s.codexModel : provider === "local" ? localAiModel() : s.claudeModel;

/** The local AI's address and model, as set on its page (plugins/local-ai/config). */
const localAiUrl = (): string => localAiConfig().url;
const localAiModel = (): string => localAiConfig().model;

/**
 * A prompt answered as JSON matching `schema` — through the LLM plugin (its task's backend and
 * model, your instructions and context in front). `task`: which of its tasks it is.
 */
export async function runAi<T>(
  prompt: string,
  schemaOut: object,
  opts: {
    task?: LlmTaskId;
    provider?: AiProvider;
    timeoutMs?: number;
    maxBudgetUsd?: number;
    /** Not from the cache of an idempotent task (an eval's repeated runs). */
    fresh?: boolean;
    /** Someone is waiting for it (a widget being built): ahead of the background's AI calls (llm/run.ts gate). */
    urgent?: boolean;
  } = {},
): Promise<AiAnswer<T>> {
  const { llm } = await import("@/plugins/llm/run");
  return llm<T>(opts.task ?? "general", prompt, schemaOut, opts);
}
