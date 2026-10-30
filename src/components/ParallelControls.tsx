"use client";

import { applyParallelAction, setDefaultParallelModeAction } from "@/app/parallel-actions";
import { useT } from "@/components/I18nProvider";
import type { T } from "@/lib/i18n/shared";
import { useAction } from "@/components/useAction";

type Result = { ok: boolean; error?: string; message?: string } | null;
type Mode = "combine" | "divide" | "sequential";

/** The ways to BOOK a group (the tasks themselves are never changed): their names and what each does. */
export const modeText = (t: T) => ({
  combine: { label: t("Book all on group"), what: t("One spanning entry for the stretch (its hours = what the tasks span) books it all; the tasks stay as they are and book nothing themselves.") },
  collect: { label: t("Book all on group"), what: t("The collecting entry books the group's hours; the tasks stay as they are and book nothing themselves.") },
  divide: { label: t("Divide time on subtasks"), what: t("The group's time is shared between the tasks (3 h over two → 1.5 + 1.5); each task keeps its real hours.") },
  sequential: { label: t("Book sequential"), what: t("Each task books what it worked, one after the other (the hours add up); the group itself books nothing.") },
  remainder: { label: t("Book subentries sequential and remaining time on group"), what: t("The tasks book what they worked, one after the other, and the collecting entry the time that is left of its total.") },
});

function useRun() {
  const t = useT();
  return useAction<Result>({ done: t("Done."), fallback: t("Didn't work.") });
}

/** Detected parallel work: group it, booked combined, divided, or one after the other. */
export function ParallelActions({ ids, spanHours, sumHours }: { ids: number[]; spanHours: string; sumHours: string }) {
  const t = useT();
  const { run, pending } = useRun();
  const m = modeText(t);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {(["combine", "divide", "sequential"] as const).map((mode) => (
        <button key={mode} type="button" className="btn btn-sm" disabled={pending} title={m[mode].what} onClick={() => run(() => applyParallelAction(ids, mode))}>
          {mode === "combine" ? t("{name} ({h} h)", { name: m.combine.label, h: spanHours }) : mode === "divide" ? t("{name} ({h} h)", { name: m.divide.label, h: spanHours }) : t("{name} ({h} h)", { name: m.sequential.label, h: sumHours })}
        </button>
      ))}
    </div>
  );
}

/** What parallel work does when it is noticed as it is booked. */
export function ParallelDefaultSetting({ mode }: { mode: Mode }) {
  const t = useT();
  const { run, pending } = useRun();
  const m = modeText(t);
  return (
    <div className="space-y-1">
      <label className="label" htmlFor="parallelMode">
        {t("Parallel work, by default")}
      </label>
      <select id="parallelMode" className="input max-w-xs" defaultValue={mode} disabled={pending} onChange={(e) => run(() => setDefaultParallelModeAction(e.target.value))}>
        {(["combine", "divide", "sequential"] as const).map((x) => (
          <option key={x} value={x}>
            {m[x].label}
          </option>
        ))}
      </select>
      <p className="text-xs text-zinc-500">{m[mode].what}</p>
    </div>
  );
}
