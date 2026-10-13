"use client";

import { FormError } from "@/components/FormError";
import { useActionState } from "react";
import { syncBoardsAction } from "@/plugins/jira/server-actions";
import type { ActionState } from "@/app/action-helpers";
import { SubmitButton } from "./SubmitButton";
import { useT } from "@/components/I18nProvider";

export function BoardSyncControls() {
  const t = useT();
  const [state, run] = useActionState<ActionState, FormData>(syncBoardsAction, null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <form action={run}>
        <SubmitButton className="btn btn-sm" pendingText={t("Syncing boards…")}>
          {t("Sync boards")}
        </SubmitButton>
      </form>
      {state?.error && <FormError>{state.error}</FormError>}
      {state?.ok && <span className="text-sm text-emerald-600 dark:text-emerald-400">{state.message}</span>}
    </div>
  );
}
