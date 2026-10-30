import { t } from "@/lib/i18n/server";
import { AiSettingsForm } from "@/components/AiSettingsForm";
import Link from "next/link";
import { rich } from "@/lib/i18n/rich";
import { aiChoice, aiProviders, getAppSettings } from "@/lib/ai";
import { AI_PROVIDER_INFO, type AiProvider } from "@/lib/ai/shared";
import { codexModelsNow } from "@/plugins/codex-cli/cli";
import { copilotModels } from "@/plugins/copilot-cli/cli";
import { LlmSettingsForm } from "@/plugins/llm/LlmSettingsForm";
import { UsagePanel } from "@/plugins/llm/UsagePanel";
import { ensureSystemPrompts, systemPrompts } from "@/lib/prompts";
import { llmChoice } from "@/plugins/llm/run";
import { getLlmSettings } from "@/plugins/llm/settings";
import { LLM_TASKS } from "@/plugins/llm/tasks";
import { isInstalled } from "@/plugins/state";

/**
 * The LLM plugin's part of the AI settings (/settings/ai; was /llm): the AI layer every AI task of Zeff goes through — its
 * backends (the CLI plugins) and their models, your instructions and context for every prompt and agent, and which backend
 * each task runs with.
 */
export async function LlmSections() {
  if (!isInstalled("llm"))
    return (
      <section id="backends" className="card scroll-mt-4 space-y-1 p-4">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Backends")}</h2>
        <p className="text-sm text-zinc-500">
          {rich(t("Backends, models, your instructions and the context for all AI tasks and agents are set in the <link>LLM plugin (not installed)</link>."), {
            link: (s) => (
              <Link href="/plugins" className="text-indigo-600 hover:underline dark:text-indigo-400">
                {s}
              </Link>
            ),
          })}
        </p>
      </section>
    );
  const s = getAppSettings();
  const providers = aiProviders();
  const found = Object.fromEntries(providers.map((p) => [p.id, p.found])) as Record<AiProvider, string | null>;
  return (
    <>
      <section id="backends" className="card scroll-mt-4 space-y-3 p-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Backends")}</h2>
          <p className="max-w-[75ch] text-sm text-zinc-500">
            {t(
              "The default for all tasks and the model per backend. The analyses run headless and closed: the data goes with the prompt, without tools, files or servers of their own. Each with its own sign-in.",
            )}
          </p>
        </div>
        <AiSettingsForm
          provider={aiChoice().provider}
          installed={providers.map((p) => p.id)}
          claudeModel={s.claudeModel}
          copilotModel={s.copilotModel}
          copilotModels={found.copilot ? await copilotModels() : []}
          codexModel={s.codexModel}
          codexModels={found.codex ? codexModelsNow().map((m) => ({ id: m.id, label: m.label })) : []}
          found={found}
        />
      </section>
      <UsagePanel />
      <section id="instructions" className="card scroll-mt-4 space-y-3 p-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Instructions, context & tasks")}</h2>
          <p className="max-w-[75ch] text-sm text-zinc-500">
            {t("Goes before every prompt, to every worker and to every agent via MCP (start_todo) — and a backend of its own per task, if you want.")}
          </p>
        </div>
        <LlmSettingsForm
          initial={getLlmSettings()}
          providers={providers.map((p) => ({ id: p.id, label: AI_PROVIDER_INFO[p.id].label }))}
          effective={Object.fromEntries(LLM_TASKS.map((task) => [task.id, llmChoice(task.id)]))}
          pages={await promptPages()}
        />
      </section>
    </>
  );
}

/** The instructions' and the context's pages (System → Prompts), made if not yet. */
async function promptPages(): Promise<{ instructions: string | null; context: string | null }> {
  await ensureSystemPrompts();
  const all = await systemPrompts();
  const href = (key: string) => {
    const id = all.find((x) => x.key === key)?.pageId;
    return id ? `/workspace/${id}` : null;
  };
  return { instructions: href("llm-instructions"), context: href("llm-context") };
}
