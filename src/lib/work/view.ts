import { aiChoice, aiProviders, getAppSettings } from "@/lib/ai";
import { claudeModels, copilotModelName } from "@/lib/ai/shared";
import { t } from "@/lib/i18n/server";
import { listRepos } from "@/lib/repos";
import type { WorkSettingsView } from "./shared";
import { getWorkSettings } from "./store";

export type WorkSettingsData = {
  settings: WorkSettingsView;
  preferred: "claude" | "copilot";
  /** The repos (Repos page) — none: workers have nowhere to work yet. */
  repos: { name: string; ok: boolean }[];
  /** The Settings provider's model (what workers get unless the Code settings pick another), and the models to pick from. */
  defaultModel: string;
  models: { value: string; label: string }[];
};

/** What the Work section of the Settings page shows: the workers' settings, the provider's models, the repos. */
export function workSettingsData(copilot: string[] = []): WorkSettingsData {
  const app = getAppSettings();
  // (ChatGPT has no workers yet: then Claude, else Copilot.)
  const chosen = aiChoice().provider;
  const preferred: "claude" | "copilot" = chosen === "codex" ? (aiProviders().some((p) => p.id === "claude") ? "claude" : "copilot") : chosen;
  return {
    settings: getWorkSettings(),
    preferred,
    repos: listRepos().map((r) => ({ name: r.name, ok: r.ok })),
    defaultModel: preferred === "copilot" ? app.copilotModel : app.claudeModel,
    models:
      preferred === "copilot"
        ? [{ value: "auto", label: t("Auto — Copilot picks") }, ...copilot.map((m) => ({ value: m, label: copilotModelName(m) }))]
        : claudeModels(t).filter((m) => m.value).map((m) => ({ value: m.value, label: m.label })),
  };
}
