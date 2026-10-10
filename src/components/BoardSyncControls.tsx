"use client";

import { useActionState } from "react";
import { syncBoardsAction } from "@/plugins/jira/server-actions";
import type { ActionState } from "@/app/action-helpers";
import { SubmitButton } from "./SubmitButton";

export function BoardSyncControls() {
  const [state, run] = useActionState<ActionState, FormData>(syncBoardsAction, null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <form action={run}>
        <SubmitButton className="btn btn-sm" pendingText="Syncing boards…">
          Sync boards
        </SubmitButton>
      </form>
      {state?.error && <span className="text-sm text-red-600 dark:text-red-400">{state.error}</span>}
      {state?.ok && <span className="text-sm text-emerald-600 dark:text-emerald-400">{state.message}</span>}
    </div>
  );
}
