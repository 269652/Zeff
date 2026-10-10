"use client";

import { useEffect, useState, useTransition } from "react";
import { pullRoarAction, pullRoarApprovalsAction, pullRoarMonthAction } from "@/plugins/roar/server-actions";
import type { ActionState } from "@/app/action-helpers";
import { PulledAtIcon } from "./PulledAtIcon";

/**
 * Reads the approval statuses of a week's — a month's, or the approvals card's two months'
 * — entries from Roar (read-only) for the marks, the monthly calendar and the card.
 */
export function RoarPullButton({
  week,
  month,
  approvals,
  pulledAt,
  synced = false,
}: {
  week?: string;
  month?: string;
  /** The last full and the current month (the approvals card). */
  approvals?: boolean;
  pulledAt: string | null;
  /** Every entry is in Roar (none rejected), as of the last pull — for the approvals: every week pulled lately. */
  synced?: boolean;
}) {
  const [state, setState] = useState<ActionState>(null);
  const [pending, startTransition] = useTransition();
  const pull = () => (approvals ? pullRoarApprovalsAction() : month ? pullRoarMonthAction(month) : pullRoarAction(week ?? ""));
  const scope = approvals ? "the last and this month's weeks'" : month ? "this month's weeks'" : "this week's";
  // A pull's result shows for a moment; when it was pulled stays behind the clock.
  useEffect(() => {
    if (!state?.ok) return;
    const t = setTimeout(() => setState(null), 6000);
    return () => clearTimeout(t);
  }, [state]);
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
      {state?.error && <span className="text-red-600 dark:text-red-400">{state.error}</span>}
      {state?.ok && state.message && <span className="text-emerald-600 dark:text-emerald-400">{state.message}</span>}
      <button
        type="button"
        className="btn btn-sm"
        disabled={pending}
        onClick={() => startTransition(async () => setState(await pull()))}
        aria-label={`Pull Roar — read ${scope} entries from Roar with their approval status (nothing is changed in Roar)`}
      >
        {pending ? "Pulling from Roar…" : "Pull Roar"}
        <PulledAtIcon
          source="Roar"
          pulledAt={pulledAt}
          synced={synced}
          syncedNote={approvals ? "Every week pulled within the last 4 h" : `Every entry of ${month ? "this month" : "this week"} is in Roar`}
          reads={`Reads ${scope} entries from Roar with their approval status — nothing is changed in Roar.`}
        />
      </button>
    </div>
  );
}
