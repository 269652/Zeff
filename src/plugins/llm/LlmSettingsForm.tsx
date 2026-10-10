"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveLlmSettingsAction } from "@/plugins/llm/server-actions";
import { toast } from "@/components/Toaster";
import { LLM_TASKS, type LlmSettings, type LlmTaskSetting } from "./tasks";

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
  providers: { id: "copilot" | "claude"; label: string }[];
  /** What each task runs with now. */
  effective: Record<string, { provider: string; model: string }>;
}) {
  const router = useRouter();
  const [instructions, setInstructions] = useState(initial.instructions);
  const [context, setContext] = useState(initial.context);
  const [tasks, setTasks] = useState<Record<string, LlmTaskSetting>>(initial.tasks as Record<string, LlmTaskSetting>);
  const [pending, start] = useTransition();
  const set = (id: string, patch: LlmTaskSetting) => setTasks((t) => ({ ...t, [id]: { ...t[id], ...patch } }));
  const save = () =>
    start(async () => {
      const r = await saveLlmSettingsAction({ instructions, context, tasks });
      toast(r?.ok ? (r.message ?? "Gespeichert.") : (r?.error ?? "Ging nicht."), { tone: r?.ok ? "ok" : "error" });
      router.refresh();
    });
  const used = instructions.length + context.length;
  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="font-medium">Anweisungen</span>
          <span className="block text-xs text-zinc-500">Wie die KI arbeiten soll — für jede Aufgabe, jeden Worker, jeden Agenten über MCP (z. B. Sprache, Ton, was sie nie tun soll).</span>
          <textarea className="input min-h-36 w-full text-sm" value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder={"z. B.\n- Antworte auf Deutsch, knapp und ohne Floskeln.\n- Nachrichten an Kunden immer per Sie.\n- Nie etwas an main pushen."} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Kontext über dich</span>
          <span className="block text-xs text-zinc-500">Wer du bist, woran du arbeitest, wer wer ist — der Hintergrund, den jede Aufgabe mitbekommt.</span>
          <textarea className="input min-h-36 w-full text-sm" value={context} onChange={(e) => setContext(e.target.value)} placeholder={"z. B.\nIch bin Entwickler im PROJ-Projekt (TYPO3).\nChristopher Ressl testet, Rico Clemen ist PM."} />
        </label>
      </div>
      <p className={`text-xs ${used > 2500 ? "text-amber-700 dark:text-amber-400" : "text-zinc-400"}`}>
        {used} Zeichen{used > 2500 ? " — in einen Prompt gehen die ersten 2500 (die Copilot CLI nimmt ihn über die Kommandozeile)" : ""}
      </p>

      <div>
        <h3 className="mb-2 text-sm font-medium">Aufgaben</h3>
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Aufgabe</th>
                <th>Backend</th>
                <th>Modell</th>
                <th>Läuft jetzt mit</th>
              </tr>
            </thead>
            <tbody>
              {LLM_TASKS.map((t) => (
                <tr key={t.id}>
                  <td className="max-w-80">
                    <span className="font-medium">{t.label}</span>
                    <span className="block text-xs text-zinc-500">{t.what}</span>
                  </td>
                  <td>
                    <select className="input py-1 text-sm" value={tasks[t.id]?.provider ?? ""} onChange={(e) => set(t.id, { provider: e.target.value as LlmTaskSetting["provider"] })}>
                      <option value="">Standard</option>
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
                      value={tasks[t.id]?.model ?? ""}
                      onChange={(e) => set(t.id, { model: e.target.value })}
                      placeholder={tasks[t.id]?.provider ? "das des Backends" : "—"}
                      disabled={!tasks[t.id]?.provider}
                      title={tasks[t.id]?.provider ? "Leer: das Modell aus den Backend-Einstellungen oben" : "Erst ein eigenes Backend wählen"}
                    />
                  </td>
                  <td className="text-xs text-zinc-500">
                    {effective[t.id]?.provider === "claude" ? "Claude CLI" : "Copilot CLI"}
                    {effective[t.id]?.model ? ` · ${effective[t.id].model}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={save}>
        {pending ? "…" : "Speichern"}
      </button>
    </div>
  );
}
