import type { Metadata } from "next";
import { connection } from "next/server";
import { AiSettingsForm } from "@/components/AiSettingsForm";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { aiChoice, aiProviders, getAppSettings } from "@/lib/ai";
import { AI_PROVIDER_INFO, type AiProvider } from "@/lib/ai/shared";
import { copilotModels } from "@/plugins/copilot-cli/cli";
import { LlmSettingsForm } from "@/plugins/llm/LlmSettingsForm";
import { llmChoice } from "@/plugins/llm/run";
import { getLlmSettings } from "@/plugins/llm/settings";
import { LLM_TASKS } from "@/plugins/llm/tasks";
import { isInstalled } from "@/plugins/state";

export const metadata: Metadata = { title: "LLM" };

/**
 * The LLM plugin: the AI layer every AI task of Zeff goes through — its backends (the CLI
 * plugins) and their models, your instructions and context for every prompt and agent, and which
 * backend each task runs with.
 */
export default async function LlmPage() {
  await connection();
  if (!isInstalled("llm")) return <PluginNotInstalled id="llm" />;
  const s = getAppSettings();
  const providers = aiProviders();
  const found = Object.fromEntries(providers.map((p) => [p.id, p.found])) as Record<AiProvider, string | null>;
  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">LLM</h1>
        <p className="max-w-[75ch] text-sm text-zinc-500">
          Die KI-Schicht: Ticket-Lage, Recap, Mail-Schritte, Auto-Aktionen und die Worker laufen alle hierüber. Backends sind die installierten CLI-Plugins (Menü → Plugins).
        </p>
      </div>
      <section className="card space-y-3 p-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">Backends</h2>
          <p className="max-w-[75ch] text-sm text-zinc-500">
            Der Standard für alle Aufgaben und das Modell je Backend. Die Analysen laufen headless und geschlossen: die Daten gehen mit dem Prompt, ohne eigene Werkzeuge, Dateien oder Server. Jedes mit seiner eigenen Anmeldung.
          </p>
        </div>
        <AiSettingsForm
          provider={aiChoice().provider}
          installed={providers.map((p) => p.id)}
          claudeModel={s.claudeModel}
          copilotModel={s.copilotModel}
          copilotModels={found.copilot ? await copilotModels() : []}
          found={found}
        />
      </section>
      <section className="card space-y-3 p-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">Anweisungen, Kontext & Aufgaben</h2>
          <p className="max-w-[75ch] text-sm text-zinc-500">Geht vor jeden Prompt, an jeden Worker und an jeden Agenten über MCP (start_todo) — und je Aufgabe ein eigenes Backend, wenn du willst.</p>
        </div>
        <LlmSettingsForm
          initial={getLlmSettings()}
          providers={providers.map((p) => ({ id: p.id, label: AI_PROVIDER_INFO[p.id].label }))}
          effective={Object.fromEntries(LLM_TASKS.map((t) => [t.id, llmChoice(t.id)]))}
        />
      </section>
    </div>
  );
}
