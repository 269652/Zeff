"use client";

import { useActionState } from "react";
import type { ActionState } from "@/app/action-helpers";
import { useT } from "@/components/I18nProvider";
import { setKeepAccountAction } from "./server-actions";

/** Which Google account's Keep the sync reads (its number in the automation Chrome, or its address). */
export function KeepAccountForm({ account }: { account: string }) {
  const t = useT();
  const [state, action, pending] = useActionState<ActionState, FormData>(setKeepAccountAction, null);
  return (
    <form action={action} className="space-y-1">
      <label className="label" htmlFor="keep-account">
        {t("Google account")}
      </label>
      <div className="flex gap-2">
        <input id="keep-account" name="account" defaultValue={account} className="input" placeholder={t("0 or name@gmail.com")} />
        <button type="submit" className="btn btn-sm" disabled={pending}>
          {t("Save")}
        </button>
      </div>
      <p className="text-xs text-zinc-500">
        {state?.error ? <span className="text-red-600 dark:text-red-400">{state.error}</span> : state?.message ?? t("0: the first one signed in in the automation Chrome, 1: the second … — or its address.")}
      </p>
    </form>
  );
}
