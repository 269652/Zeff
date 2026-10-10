import { getDb, schema } from "@/db";
import type { AppSettings } from "@/db/schema";
import { findClaudeCli } from "@/plugins/claude-cli/cli";
import { findCopilotCli } from "@/plugins/copilot-cli/cli";
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
  db.insert(appSettings).values({ id: 1 }).onConflictDoNothing().run();
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
    found: id === "claude" ? findClaudeCli() : (findCopilotCli()?.where ?? null),
  }));
}

/** The chosen provider, its model ("" = the CLI's own), and the longest prompt it takes (null: no limit). */
export function aiChoice(): { provider: AiProvider; model: string; maxPrompt: number | null } {
  const s = getAppSettings();
  // The one chosen — while its plugin is installed; else the first installed (Copilot by default).
  const chosen = AI_PROVIDERS.find((p) => p === s.aiProvider);
  const provider: AiProvider = chosen && providerAvailable(chosen) ? chosen : (AI_PROVIDERS.find((p) => providerAvailable(p)) ?? "copilot");
  return { provider, model: provider === "copilot" ? s.copilotModel : s.claudeModel, maxPrompt: null };
}

/**
 * A prompt answered as JSON matching `schema` — through the LLM plugin (its task's backend and
 * model, your instructions and context in front). `task`: which of its tasks it is.
 */
export async function runAi<T>(
  prompt: string,
  schemaOut: object,
  opts: { task?: LlmTaskId; provider?: AiProvider; timeoutMs?: number; maxBudgetUsd?: number } = {},
): Promise<AiAnswer<T>> {
  const { llm } = await import("@/plugins/llm/run");
  return llm<T>(opts.task ?? "general", prompt, schemaOut, opts);
}
