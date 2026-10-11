"use client";

import { useActionState } from "react";
import { setAdminSessionsAction } from "@/plugins/work/server-actions";
import type { ActionState } from "@/app/action-helpers";
import { useT } from "../I18nProvider";
import { SubmitButton } from "../SubmitButton";

/** Set up automatic admin sessions (the scheduled task — Windows asks once), or remove it again. */
export function AdminSessionsForm({ task }: { task: boolean }) {
  const t = useT();
  const [state, action, pending] = useActionState<ActionState, FormData>(setAdminSessionsAction, null);
  return (
    <form action={action} className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {task ? (
          <SubmitButton name="do" value="remove" pending={pending} className="btn" confirm={t("Remove the scheduled task? Windows asks for administrator rights once more to remove it.")}>
            {t("Remove — ask each time again")}
          </SubmitButton>
        ) : (
          <SubmitButton
            name="do"
            value="install"
            pending={pending}
            className="btn btn-primary"
            confirm={t("Set up a scheduled task that starts admin sessions without asking? Windows asks for administrator rights once now. Anything that can write to your user profile could then get a process elevated through it.")}
          >
            {t("Set up — start them without asking")}
          </SubmitButton>
        )}
      </div>
      <p className="text-xs text-zinc-500">{t("Setting up and removing each ask Windows for administrator rights (a UAC prompt on your desktop).")}</p>
      {state && <p className={`text-sm ${state.ok ? "text-emerald-600" : "text-red-600"}`}>{state.ok ? state.message : state.error}</p>}
    </form>
  );
}
