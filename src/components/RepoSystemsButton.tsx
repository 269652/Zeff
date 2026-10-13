"use client";

import { useActionState } from "react";
import { readRepoSystemsAction } from "@/plugins/work/server-actions";
import type { ActionState } from "@/app/action-helpers";
import { SubmitButton } from "./SubmitButton";
import { useT } from "./I18nProvider";

/** Read the repos' systems from the knowledge again (the AI; takes a moment). */
export function RepoSystemsButton() {
  const t = useT();
  const [state, action] = useActionState<ActionState, FormData>(async () => readRepoSystemsAction(), null);
  return (
    <form action={action} className="flex items-center gap-2">
      <SubmitButton className="btn btn-secondary !py-0.5 text-xs" pendingText={t("Reading…")}>
        {t("Read again")}
      </SubmitButton>
      {state?.ok === false && <span className="text-xs text-red-600 dark:text-red-400">{state.error}</span>}
      {state?.ok && state.message && <span className="text-xs text-zinc-500">{state.message}</span>}
    </form>
  );
}
