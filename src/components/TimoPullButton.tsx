"use client";

import { useEffect, useState, useTransition } from "react";
import { pullTimoAction } from "@/plugins/timo/server-actions";
import type { ActionState } from "@/app/action-helpers";
import { PulledAtIcon } from "./PulledAtIcon";
import { useT } from "@/components/I18nProvider";

/** Reads what TimO has on the week's days (read-only) for the Booked row's TimO marks. */
export function TimoPullButton({ week, pulledAt, synced = false }: { week: string; pulledAt: string | null; synced?: boolean }) {
  const t = useT();
  const [state, setState] = useState<ActionState>(null);
  const [pending, startTransition] = useTransition();
  // A pull's result shows for a moment; when it was pulled stays behind the clock.
  useEffect(() => {
    if (!state?.ok) return;
    const timer = setTimeout(() => setState(null), 6000);
    return () => clearTimeout(timer);
  }, [state]);
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
      {state?.error && <span className="text-red-600 dark:text-red-400">{state.error}</span>}
      {state?.ok && state.message && <span className="text-blue-600 dark:text-blue-400">{state.message}</span>}
      <button
        type="button"
        className="btn btn-sm"
        disabled={pending}
        onClick={() => startTransition(async () => setState(await pullTimoAction(week)))}
        aria-label={t("Pull TimO — read what TimO has on this week's days (nothing is changed in TimO)")}
      >
        {pending ? t("Pulling from TimO…") : t("Pull TimO")}
        <PulledAtIcon
          source="TimO"
          pulledAt={pulledAt}
          synced={synced}
          tone="blue"
          syncedNote={t("Every day of this week is in TimO as in Zeff")}
          reads={t("Reads what TimO has on this week's days, to mark the days whose hours are in TimO — nothing is changed in TimO.")}
        />
      </button>
    </div>
  );
}
