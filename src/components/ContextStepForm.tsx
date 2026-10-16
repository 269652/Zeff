"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveContextPrefsAction } from "@/plugins/todos/server-actions";
import { sourceShown, type ContextStep, type StepPrefs } from "@/lib/boards/context-prefs-shared";
import { toast } from "./Toaster";
import { useT } from "@/components/I18nProvider";

/**
 * One AI step's context settings: its sources (switches, saved at once), its numbers and your own
 * instructions for it (saved with a button).
 */
export function ContextStepForm({ step, prefs, installed, prompt = null }: { step: ContextStep; prefs: StepPrefs; installed: string[]; /** Its prompt as a page of the Workspace (its own instructions are in there now). */ prompt?: { href: string; title: string } | null }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [numbers, setNumbers] = useState(prefs.numbers);
  const [extra, setExtra] = useState(prefs.extra);
  const save = (patch: Parameters<typeof saveContextPrefsAction>[1], quiet = false) =>
    start(async () => {
      const r = await saveContextPrefsAction(step.id, patch);
      if (!r?.ok || !quiet) toast(r?.ok ? (r.message ?? t("Saved.")) : (r?.error ?? t("Didn't work.")), { tone: r?.ok ? "ok" : "error" });
      router.refresh();
    });
  const sources = step.sources.filter((s) => sourceShown(s, installed));
  const dirty = extra !== prefs.extra || step.numbers.some((n) => numbers[n.key] !== prefs.numbers[n.key]);

  return (
    <div className="space-y-3">
      {sources.length > 0 && (
        <div>
          <div className="label">{t("Sources")}</div>
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
      {prompt ? (
        <p className="text-sm">
          <span className="label">{t("The prompt")}</span>{" "}
          <a href={prompt.href} className="text-indigo-600 hover:underline dark:text-indigo-400">
            📝 {prompt.title} → {t("change it in the Workspace")}
          </a>
        </p>
      ) : (
      <label className="block text-sm">
        <span className="label">{t("Your own instructions for this step")}</span>
        <textarea
          className="input w-full resize-y"
          rows={2}
          value={extra}
          placeholder={t("e.g. “ignore newsletters from X”, “always reply on first-name terms”, “customer meetings take priority”")}
          onChange={(e) => setExtra(e.target.value)}
        />
      </label>
      )}
      <div className="flex items-center gap-2">
        <button type="button" className="btn btn-sm btn-primary" disabled={pending || !dirty} onClick={() => save({ numbers, extra })}>
          {pending ? t("Saving…") : t("Save")}
        </button>
        {dirty && <span className="text-xs text-amber-600 dark:text-amber-400">{t("Not saved")}</span>}
      </div>
    </div>
  );
}
