"use client";

import { useActionState, useState, useTransition } from "react";
import { saveAiSettingsAction, testAiAction, type ActionState } from "@/app/actions";
import { AI_PROVIDER_INFO, CLAUDE_MODELS, COPILOT_MODEL_SUGGESTIONS, copilotModelFamily, copilotModelName, type AiProvider } from "@/lib/ai/shared";
import { SubmitButton } from "./SubmitButton";

/** "Test": a tiny prompt through one provider — there, signed in, how quick. */
function TestButton({ provider, disabled }: { provider: AiProvider; disabled: boolean }) {
  const [state, setState] = useState<ActionState>(null);
  const [pending, start] = useTransition();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" className="btn btn-sm" disabled={disabled || pending} onClick={() => start(async () => setState(await testAiAction(provider)))} title="Sends a tiny prompt through this CLI (uses a little of its quota)">
        {pending ? "Testing…" : "Test"}
      </button>
      {!pending && state?.ok && <span className="text-xs text-emerald-600 dark:text-emerald-400">{state.message}</span>}
      {!pending && state?.error && <span className="text-xs break-all text-red-600 dark:text-red-400">{state.error}</span>}
    </span>
  );
}

/**
 * Which AI provider analyses run through (the Todos tab's): the Claude Code CLI or GitHub's
 * Copilot CLI — each shown with where its CLI was found (or how to get it), its model, and a test.
 */
export function AiSettingsForm({
  provider,
  claudeModel,
  copilotModel,
  copilotModels = [],
  found,
  installed,
}: {
  provider: AiProvider;
  /** The providers whose plugin is installed (Settings → Plugins) — only these are offered. */
  installed: AiProvider[];
  claudeModel: string;
  copilotModel: string;
  /** The models the installed Copilot CLI takes (empty: unknown — then a text field). */
  copilotModels?: string[];
  /** Where each CLI is, as found on this machine (null: not installed). */
  found: Partial<Record<AiProvider, string | null>>;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveAiSettingsAction, null);
  const [chosen, setChosen] = useState<AiProvider>(provider);
  const card = (id: AiProvider, model: React.ReactNode) => (
    <label
      className={`block cursor-pointer space-y-2 rounded-lg border p-4 transition ${chosen === id ? "border-indigo-500 ring-2 ring-indigo-500/20" : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800"}`}
    >
      <span className="flex items-center gap-2">
        <input type="radio" name="aiProvider" value={id} checked={chosen === id} onChange={() => setChosen(id)} className="accent-indigo-600" />
        <span className="font-medium">{AI_PROVIDER_INFO[id].label}</span>
        {found[id] ? (
          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">installed</span>
        ) : (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200">not found</span>
        )}
      </span>
      <span className="block text-xs text-zinc-500">
        {found[id] ? (
          <>
            <span className="font-mono break-all">{found[id]}</span> · {AI_PROVIDER_INFO[id].signIn}
          </>
        ) : (
          <>
            Install: <span className="font-mono">{AI_PROVIDER_INFO[id].install}</span>
          </>
        )}
      </span>
      <span className="flex flex-wrap items-end gap-3" onClick={(e) => e.preventDefault()}>
        {model}
        <TestButton provider={id} disabled={!found[id]} />
      </span>
    </label>
  );
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        {installed.includes("claude") && card(
          "claude",
          <span className="block min-w-48">
            <span className="label">Model</span>
            <select name="claudeModel" className="input" defaultValue={claudeModel}>
              {CLAUDE_MODELS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </span>,
        )}
        {installed.includes("copilot") && card(
          "copilot",
          <span className="block min-w-48">
            <span className="label">Model</span>
            {copilotModels.length ? (
              <select name="copilotModel" className="input" defaultValue={copilotModel} title="The models your Copilot CLI takes (copilot help config)">
                <option value="">Copilot&apos;s default</option>
                <option value="auto">Auto — Copilot picks</option>
                {copilotModel && copilotModel !== "auto" && !copilotModels.includes(copilotModel) && <option value={copilotModel}>{copilotModel} (not offered any more)</option>}
                {["Claude", "GPT", "Gemini", "Other"].map((family) => {
                  const list = copilotModels.filter((m) => copilotModelFamily(m) === family);
                  return list.length ? (
                    <optgroup key={family} label={family}>
                      {list.map((m) => (
                        <option key={m} value={m}>
                          {copilotModelName(m)}
                        </option>
                      ))}
                    </optgroup>
                  ) : null;
                })}
              </select>
            ) : (
              <>
                <input name="copilotModel" className="input font-mono text-xs" defaultValue={copilotModel} placeholder="empty: Copilot's default" list="copilot-models" />
                <datalist id="copilot-models">
                  {COPILOT_MODEL_SUGGESTIONS.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </>
            )}
          </span>,
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton className="btn btn-primary btn-sm" pendingText="Saving…" pending={pending}>
          Save
        </SubmitButton>
        {state?.error && <span className="text-sm text-red-600 dark:text-red-400">{state.error}</span>}
        {state?.ok && state.message && <span className="text-sm text-emerald-600 dark:text-emerald-400">{state.message}</span>}
      </div>
    </form>
  );
}
