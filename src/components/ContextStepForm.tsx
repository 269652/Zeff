"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveContextPrefsAction } from "@/app/actions";
import { sourceShown, type ContextStep, type StepPrefs } from "@/lib/boards/context-prefs-shared";
import { toast } from "./Toaster";

/**
 * One AI step's context settings: its sources (switches, saved at once), its numbers and your own
 * instructions for it (saved with a button).
 */
export function ContextStepForm({ step, prefs, installed }: { step: ContextStep; prefs: StepPrefs; installed: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [numbers, setNumbers] = useState(prefs.numbers);
  const [extra, setExtra] = useState(prefs.extra);
  const save = (patch: Parameters<typeof saveContextPrefsAction>[1], quiet = false) =>
    start(async () => {
      const r = await saveContextPrefsAction(step.id, patch);
      if (!r?.ok || !quiet) toast(r?.ok ? (r.message ?? "Gespeichert.") : (r?.error ?? "Ging nicht."), { tone: r?.ok ? "ok" : "error" });
      router.refresh();
    });
  const sources = step.sources.filter((s) => sourceShown(s, installed));
  const dirty = extra !== prefs.extra || step.numbers.some((n) => numbers[n.key] !== prefs.numbers[n.key]);

  return (
    <div className="space-y-3">
      {sources.length > 0 && (
        <div>
          <div className="label">Quellen</div>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {sources.map((s) => (
              <li key={s.key}>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4"
                    checked={prefs.sources[s.key]}
                    disabled={pending}
                    onChange={(e) => save({ sources: { [s.key]: e.target.checked } }, true)}
                  />
                  <span>
                    <span className="font-medium">{s.label}</span>
                    {s.what && <span className="block text-xs text-zinc-500">{s.what}</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
      {step.numbers.length > 0 && (
        <div className="flex flex-wrap gap-4">
          {step.numbers.map((n) => (
            <label key={n.key} className="text-sm">
              <span className="label">{n.label}</span>
              <span className="flex items-center gap-1.5">
                <input
                  type="number"
                  className="input num w-24"
                  min={n.min}
                  max={n.max}
                  value={numbers[n.key]}
                  onChange={(e) => setNumbers((v) => ({ ...v, [n.key]: Number(e.target.value) }))}
                />
                {n.unit && <span className="text-zinc-500">{n.unit}</span>}
              </span>
            </label>
          ))}
        </div>
      )}
      <label className="block text-sm">
        <span className="label">Eigene Anweisungen für diesen Schritt</span>
        <textarea
          className="input w-full resize-y"
          rows={2}
          value={extra}
          placeholder="z. B. „Newsletter von X ignorieren“, „Antworten immer per du“, „Kundentermine haben Vorrang“"
          onChange={(e) => setExtra(e.target.value)}
        />
      </label>
      <div className="flex items-center gap-2">
        <button type="button" className="btn btn-sm btn-primary" disabled={pending || !dirty} onClick={() => save({ numbers, extra })}>
          {pending ? "Speichert…" : "Speichern"}
        </button>
        {dirty && <span className="text-xs text-amber-600 dark:text-amber-400">Nicht gespeichert</span>}
      </div>
    </div>
  );
}
