"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveLlmSettingsAction } from "@/plugins/llm/server-actions";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";
import { llmTasks, type LlmSettings, type LlmTaskSetting } from "./tasks";

/**
 * The LLM plugin's settings: your instructions and context (with every prompt, every worker and
 * agent), and per task its backend and model — or the default.
 */
export function LlmSettingsForm({
  initial,
  providers,
  effective,
}: {
  initial: LlmSettings;
  /** The installed backends. */
  providers: { id: "copilot" | "claude" | "codex"; label: string }[];
  /** What each task runs with now. */
  effective: Record<string, { provider: string; model: string }>;
}) {
  const t = useT();
  const router = useRouter();
  const [instructions, setInstructions] = useState(initial.instructions);
  const [context, setContext] = useState(initial.context);
  const [tasks, setTasks] = useState<Record<string, LlmTaskSetting>>(initial.tasks as Record<string, LlmTaskSetting>);
  const [pending, start] = useTransition();
  const set = (id: string, patch: LlmTaskSetting) => setTasks((all) => ({ ...all, [id]: { ...all[id], ...patch } }));
  const save = () =>
    start(async () => {
      const r = await saveLlmSettingsAction({ instructions, context, tasks });
      toast(r?.ok ? (r.message ?? t("Saved.")) : (r?.error ?? t("That didn't work.")), { tone: r?.ok ? "ok" : "error" });
      router.refresh();
    });
  const used = instructions.length + context.length;
  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="font-medium">{t("Instructions")}</span>
          <span className="block text-xs text-zinc-500">{t("How the AI should work — for every task, every worker, every agent over MCP (e.g. language, tone, what it must never do).")}</span>
          <textarea
            className="input min-h-36 w-full text-sm"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder={t("e.g.\n- Answer briefly, without filler.\n- Always address customers formally.\n- Never push anything to main.")}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">{t("Context about you")}</span>
          <span className="block text-xs text-zinc-500">{t("Who you are, what you work on, who is who — the background every task gets.")}</span>
          <textarea
            className="input min-h-36 w-full text-sm"
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder={t("e.g.\nI'm a developer on the PROJ project (TYPO3).\nChristopher Lorenz tests, Rico Clemen is the PM.")}
          />
        </label>
      </div>
      <p className={`text-xs ${used > 2500 ? "text-amber-700 dark:text-amber-400" : "text-zinc-400"}`}>
        {used > 2500 ? t("{n} characters — the first 2500 go into a prompt (the Copilot CLI takes it on the command line)", { n: used }) : t("{n} characters", { n: used })}
      </p>

      <div>
        <h3 className="mb-2 text-sm font-medium">{t("Tasks")}</h3>
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t("Task")}</th>
                <th scope="col">{t("Backend")}</th>
                <th scope="col">{t("Model")}</th>
                <th scope="col">{t("Runs with now")}</th>
              </tr>
            </thead>
            <tbody>
              {llmTasks(t).map((task) => (
                <tr key={task.id}>
                  <td className="max-w-80">
                    <span className="font-medium">{task.label}</span>
                    <span className="block text-xs text-zinc-500">{task.what}</span>
                  </td>
                  <td>
                    <select className="input py-1 text-sm" value={tasks[task.id]?.provider ?? ""} onChange={(e) => set(task.id, { provider: e.target.value as LlmTaskSetting["provider"] })}>
                      <option value="">{t("Default")}</option>
                      {providers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      className="input w-40 py-1 font-mono text-xs"
                      value={tasks[task.id]?.model ?? ""}
                      onChange={(e) => set(task.id, { model: e.target.value })}
                      placeholder={tasks[task.id]?.provider ? t("the backend's") : "—"}
                      disabled={!tasks[task.id]?.provider}
                      title={tasks[task.id]?.provider ? t("Empty: the model from the backend settings above") : t("Choose a backend of its own first")}
                    />
                  </td>
                  <td className="text-xs text-zinc-500">
                    {effective[task.id]?.provider === "claude" ? "Claude CLI" : effective[task.id]?.provider === "codex" ? "ChatGPT" : "Copilot CLI"}
                    {effective[task.id]?.model ? ` · ${effective[task.id].model}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={save}>
        {pending ? "…" : t("Save")}
      </button>
    </div>
  );
}
