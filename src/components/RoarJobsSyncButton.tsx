"use client";

import { useState, useTransition } from "react";
import { syncRoarJobsAction } from "@/plugins/roar/server-actions";
import type { ActionState } from "@/app/action-helpers";
import { useT } from "@/components/I18nProvider";

/** Looks every job up in Roar's job search and refreshes the Roar column (nothing is added in Roar). */
export function RoarJobsSyncButton({ count }: { count: number }) {
  const t = useT();
  const [state, setState] = useState<ActionState>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {state?.error && <span className="text-sm text-red-600 dark:text-red-400">{state.error}</span>}
      {state?.ok && state.message && <span className="text-sm text-emerald-600 dark:text-emerald-400">{state.message}</span>}
      <button
        type="button"
        className="btn btn-sm"
        disabled={pending || count === 0}
        onClick={() => startTransition(async () => setState(await syncRoarJobsAction()))}
        title={t("Look every job up in Roar's job search (read-only — nothing is added in Roar)")}
      >
        {pending ? t("Checking {n} jobs in Roar…", { n: count }) : t("Sync with Roar")}
      </button>
    </div>
  );
}
