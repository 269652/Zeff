"use client";

import { useActionState } from "react";
import { exportToRoarAction, roarStatusAction } from "@/plugins/roar/server-actions";
import type { ActionState } from "@/app/action-helpers";
import { SubmitButton } from "./SubmitButton";

export function RoarExportControls({ week, by }: { week: string; by?: string }) {
  const [exp, exportAction] = useActionState<ActionState, FormData>(exportToRoarAction, null);
  const [stat, statusAction] = useActionState<ActionState, FormData>(roarStatusAction, null);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <form action={statusAction}>
          <SubmitButton className="btn btn-sm" pendingText="Checking…">
            Check Roar connection
          </SubmitButton>
        </form>
        <form action={exportAction} className="flex items-center gap-2">
          <input type="hidden" name="week" value={week} />
          {by ? <input type="hidden" name="by" value={by} /> : null}
          <SubmitButton className="btn btn-sm" name="dryRun" value="on" pendingText="Reading Roar…">
            Dry run (preview changes)
          </SubmitButton>
          <SubmitButton className="btn btn-primary" pendingText="Filling Roar…">
            Fill in Roar
          </SubmitButton>
        </form>
      </div>

      {stat?.message && <p className="text-sm text-zinc-600 dark:text-zinc-300">{stat.message}</p>}
      {stat?.error && <p className="text-sm text-red-600 dark:text-red-400">{stat.error}</p>}
      {(exp?.message || exp?.error) && (
        <pre
          className={`overflow-x-auto rounded-lg border p-3 text-xs whitespace-pre-wrap ${
            exp?.error ? "border-red-200 text-red-700 dark:border-red-900 dark:text-red-300" : "border-zinc-200 dark:border-zinc-800"
          }`}
        >
          {exp?.error ?? exp?.message}
        </pre>
      )}
    </div>
  );
}
