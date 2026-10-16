import { getPref, setPref } from "@/lib/prefs";
import { stepFolded } from "@/lib/prompts";
import { t } from "@/lib/i18n/server";
import { CONTEXT_STEPS, withDefaults, type ContextPrefs, type ContextStepId, type StepPrefs } from "./context-prefs-shared";

export type { ContextPrefs, StepPrefs } from "./context-prefs-shared";

const KEY = "auswerten";

/** What goes into each AI step's context (Menu → Auswerten) — the defaults where nothing is set. Per account. */
export const getContextPrefs = (): ContextPrefs => withDefaults(getPref(KEY, {}));

/** One step's settings changed (sources, numbers, instructions) — the others as they are. */
export function setStepPrefs(step: ContextStepId, patch: Partial<StepPrefs>): ContextPrefs {
  const def = CONTEXT_STEPS.find((s) => s.id === step);
  if (!def) throw new Error(t("Unknown step."));
  const cur = getPref<Record<string, Partial<StepPrefs>>>(KEY, {});
  const was = withDefaults(cur)[step];
  const next: StepPrefs = {
    sources: { ...was.sources, ...Object.fromEntries(Object.entries(patch.sources ?? {}).filter(([k, v]) => def.sources.some((s) => s.key === k) && typeof v === "boolean")) },
    numbers: { ...was.numbers, ...Object.fromEntries(Object.entries(patch.numbers ?? {}).filter(([k, v]) => def.numbers.some((n) => n.key === k) && Number.isFinite(v))) },
    extra: typeof patch.extra === "string" ? patch.extra.slice(0, 2000) : was.extra,
  };
  setPref(KEY, { ...cur, [step]: next });
  return getContextPrefs();
}

/** A step's own instructions as a prompt block (empty: none). */
export const extraBlock = (step: ContextStepId) => {
  // In its prompt's page now (System → Prompts): not added on top.
  if (stepFolded(step)) return "";
  const extra = getContextPrefs()[step].extra.trim();
  return extra ? `\n\n## Meine Anweisungen für diesen Schritt\n${extra}` : "";
};
