"use client";

import { useActionState, useState, useTransition } from "react";
import { saveAiSettingsAction, testAiAction } from "@/plugins/llm/server-actions";
import type { ActionState } from "@/app/action-helpers";
import { aiProviderInfo, claudeModels, COPILOT_MODEL_SUGGESTIONS, copilotModelFamily, copilotModelName, type AiProvider } from "@/lib/ai/shared";
import { SubmitButton } from "./SubmitButton";
import { useT } from "@/components/I18nProvider";

/** "Test": a tiny prompt through one provider — there, signed in, how quick. */
function TestButton({ provider, disabled }: { provider: AiProvider; disabled: boolean }) {
  const t = useT();
  const [state, setState] = useState<ActionState>(null);
  const [pending, start] = useTransition();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" className="btn btn-sm" disabled={disabled || pending} onClick={() => start(async () => setState(await testAiAction(provider)))} title={t("Sends a tiny prompt through this CLI (uses a little of its quota)")}>
        {pending ? t("Testing…") : t("Test")}
      </button>
      {!pending && state?.ok && <span className="text-xs text-emerald-600 dark:text-emerald-400">{state.message}</span>}
      {!pending && state?.error && <span className="text-xs break-all text-red-600 dark:text-red-400">{state.error}</span>}
    </span>
  );
}

/**
 * Which AI provider analyses run through (the Todos tab's): the Claude Code CLI, GitHub's
 * Copilot CLI or OpenAI's Codex CLI (ChatGPT) — each shown with where its CLI was found (or how to get it), its model, and a test.
 */
export function AiSettingsForm({
  provider,
  claudeModel,
  copilotModel,
  copilotModels = [],
  codexModel = "",
  codexModels = [],
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
  codexModel?: string;
  /** The models the Codex CLI offers your ChatGPT account (empty: unknown — then a text field). */
  codexModels?: { id: string; label: string }[];
  /** Where each CLI is, as found on this machine (null: not installed). */
  found: Partial<Record<AiProvider, string | null>>;
}) {
  const t = useT();
  const info = aiProviderInfo(t);
  const [state, action, pending] = useActionState<ActionState, FormData>(saveAiSettingsAction, null);
  const [, startSave] = useTransition();
  const [chosen, setChosen] = useState<AiProvider>(provider);
  const card = (id: AiProvider, model: React.ReactNode) => (
    <label
      className={`block cursor-pointer space-y-2 rounded-lg border p-4 transition ${chosen === id ? "border-indigo-500 ring-2 ring-indigo-500/20" : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800"}`}
    >
      <span className="flex items-center gap-2">
        <input type="radio" name="aiProvider" value={id} checked={chosen === id} onChange={() => setChosen(id)} className="accent-indigo-600" />
        <span className="font-medium">{info[id].label}</span>
        {found[id] ? (
          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">{t("installed")}</span>
        ) : (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200">{t("not found")}</span>
        )}
      </span>
      <span className="block text-xs text-zinc-500">
        {found[id] ? (
          <>
            <span className="font-mono break-all">{found[id]}</span> · {info[id].signIn}
          </>
        ) : (
          <>
            {t("Install:")} <span className="font-mono">{info[id].install}</span>
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
    // Not <form action>: React resets such a form after its action — a controlled radio would go back to its first state (the card flips back, the next save sends the old one).
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startSave(() => action(data));
      }}
    >
      <div className="grid gap-3 md:grid-cols-2">
        {installed.includes("claude") && card(
          "claude",
          <span className="block min-w-48">
            <span className="label">{t("Model")}</span>
            <select name="claudeModel" className="input" defaultValue={claudeModel}>
              {claudeModels(t).map((m) => (
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
            <span className="label">{t("Model")}</span>
            {copilotModels.length ? (
              <select name="copilotModel" className="input" defaultValue={copilotModel} title={t("The models your Copilot CLI takes (copilot help config)")}>
                <option value="">{t("Copilot's default")}</option>
                <option value="auto">{t("Auto — Copilot picks")}</option>
                {copilotModel && copilotModel !== "auto" && !copilotModels.includes(copilotModel) && <option value={copilotModel}>{t("{model} (not offered any more)", { model: copilotModel })}</option>}
                {["Claude", "GPT", "Gemini", "Other"].map((family) => {
                  const list = copilotModels.filter((m) => copilotModelFamily(m) === family);
                  return list.length ? (
                    <optgroup key={family} label={family === "Other" ? t("Other") : family}>
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
                <input name="copilotModel" className="input font-mono text-xs" defaultValue={copilotModel} placeholder={t("empty: Copilot's default")} list="copilot-models" />
                <datalist id="copilot-models">
                  {COPILOT_MODEL_SUGGESTIONS.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </>
            )}
          </span>,
        )}
        {installed.includes("codex") && card(
          "codex",
          <span className="block min-w-48">
            <span className="label">{t("Model")}</span>
            {codexModels.length ? (
              <select name="codexModel" className="input" defaultValue={codexModel} title={t("The models the Codex CLI offers your ChatGPT account")}>
                <option value="">{t("ChatGPT's default")}</option>
                {codexModel && !codexModels.some((m) => m.id === codexModel) && <option value={codexModel}>{t("{model} (not offered any more)", { model: codexModel })}</option>}
                {codexModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            ) : (
              <input name="codexModel" className="input font-mono text-xs" defaultValue={codexModel} placeholder={t("empty: ChatGPT's default")} />
            )}
          </span>,
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton className="btn btn-primary btn-sm" pendingText={t("Saving…")} pending={pending}>
          {t("Save")}
        </SubmitButton>
        {state?.error && <span className="text-sm text-red-600 dark:text-red-400">{state.error}</span>}
        {state?.ok && state.message && <span className="text-sm text-emerald-600 dark:text-emerald-400">{state.message}</span>}
      </div>
    </form>
  );
}
