import { aiProviders } from "@/lib/ai";
import { CLAUDE_MODELS } from "@/lib/ai/shared";
import type { BackendChoices, ComposerOptions } from "@/lib/work/composer-shared";
import { liveDriverFor } from "@/lib/work/live-driver";
import { claudeSessionSettings } from "@/lib/work/store";
import { codexModels } from "@/plugins/codex-cli/cli";
import { llmChoice } from "@/plugins/llm/run";
import { elevationAvailable } from "@/plugins/work-elevated/elevate";
import { providerAvailable } from "@/plugins/state";

/** The Work tab's composer options (server): the installed backends and what each lets you choose. */
export async function composerOptions(): Promise<ComposerOptions> {
  const cs = claudeSessionSettings();
  const found = aiProviders().filter((p) => p.found);
  const choices: Record<string, BackendChoices> = {};
  const providers: ComposerOptions["providers"] = [];
  for (const p of found) {
    const driver = liveDriverFor(p.id);
    const live = !!driver && cs.live && providerAvailable(p.id);
    // ChatGPT has no one-shot workers: without live sessions it isn't offered.
    if (!live && p.id === "codex") continue;
    if (live && driver) {
      const modes = driver.modes({ allowBypass: cs.allowBypass });
      if (p.id === "claude") {
        choices[p.id] = {
          modes,
          defaultMode: cs.mode,
          models: CLAUDE_MODELS.map((m) => ({ value: m.value, label: m.label })),
          effort: true,
          defaultEffort: cs.effort,
          admin: elevationAvailable(),
        };
      } else if (p.id === "codex") {
        choices[p.id] = {
          modes,
          defaultMode: modes[0]?.id ?? "",
          models: [{ value: "", label: "" }, ...(await codexModels()).map((m) => ({ value: m.id, label: m.label, efforts: m.efforts }))],
          effort: true,
          defaultEffort: "",
          admin: false,
        };
      }
    }
    providers.push({ id: p.id, label: p.label, live: p.id in choices });
  }
  const wanted = llmChoice("worker").provider;
  return { defaultProvider: providers.some((p) => p.id === wanted) ? wanted : (providers[0]?.id ?? wanted), providers, choices };
}
