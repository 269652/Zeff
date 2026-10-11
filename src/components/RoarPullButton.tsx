"use client";

import { useEffect, useState, useTransition } from "react";
import { pullRoarAction, pullRoarApprovalsAction, pullRoarMonthAction } from "@/plugins/roar/server-actions";
import type { ActionState } from "@/app/action-helpers";
import { PulledAtIcon } from "./PulledAtIcon";
import { useT } from "./I18nProvider";

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
  const t = useT();
  const [state, setState] = useState<ActionState>(null);
  const [pending, startTransition] = useTransition();
  const pull = () => (approvals ? pullRoarApprovalsAction() : month ? pullRoarMonthAction(month) : pullRoarAction(week ?? ""));
  const label = approvals
    ? t("Pull Roar — read the last and this month's weeks' entries from Roar with their approval status (nothing is changed in Roar)")
    : month
      ? t("Pull Roar — read this month's weeks' entries from Roar with their approval status (nothing is changed in Roar)")
      : t("Pull Roar — read this week's entries from Roar with their approval status (nothing is changed in Roar)");
  const reads = approvals
    ? t("Reads the last and this month's weeks' entries from Roar with their approval status — nothing is changed in Roar.")
    : month
      ? t("Reads this month's weeks' entries from Roar with their approval status — nothing is changed in Roar.")
      : t("Reads this week's entries from Roar with their approval status — nothing is changed in Roar.");
  // A pull's result shows for a moment; when it was pulled stays behind the clock.
  useEffect(() => {
    if (!state?.ok) return;
    const timer = setTimeout(() => setState(null), 6000);
    return () => clearTimeout(timer);
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
        aria-label={label}
      >
        {pending ? t("Pulling from Roar…") : t("Pull Roar")}
        <PulledAtIcon
          source="Roar"
          pulledAt={pulledAt}
          synced={synced}
          syncedNote={approvals ? t("Every week pulled within the last 4 h") : month ? t("Every entry of this month is in Roar") : t("Every entry of this week is in Roar")}
          reads={reads}
        />
      </button>
    </div>
  );
}
