"use client";

import { useEffect, useState, useTransition } from "react";
import { pullTimoAction, type ActionState } from "@/app/actions";
import { PulledAtIcon } from "./PulledAtIcon";

/** Reads what TimO has on the week's days (read-only) for the Booked row's TimO marks. */
export function TimoPullButton({ week, pulledAt, synced = false }: { week: string; pulledAt: string | null; synced?: boolean }) {
  const [state, setState] = useState<ActionState>(null);
  const [pending, startTransition] = useTransition();
  // A pull's result shows for a moment; when it was pulled stays behind the clock.
  useEffect(() => {
    if (!state?.ok) return;
    const t = setTimeout(() => setState(null), 6000);
    return () => clearTimeout(t);
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
        aria-label="Pull TimO — read what TimO has on this week's days (nothing is changed in TimO)"
      >
        {pending ? "Pulling from TimO…" : "Pull TimO"}
        <PulledAtIcon
          source="TimO"
          pulledAt={pulledAt}
          synced={synced}
          tone="blue"
          syncedNote="Every day of this week is in TimO as in Zeff"
          reads="Reads what TimO has on this week's days, to mark the days whose hours are in TimO — nothing is changed in TimO."
        />
      </button>
    </div>
  );
}
