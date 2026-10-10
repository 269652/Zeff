"use client";

import { useActionState } from "react";
import type { ActionState } from "@/app/action-helpers";
import { setKeepAccountAction } from "./actions";

/** Which Google account's Keep the sync reads (its number in the automation Chrome, or its address). */
export function KeepAccountForm({ account }: { account: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(setKeepAccountAction, null);
  return (
    <form action={action} className="space-y-1">
      <label className="label" htmlFor="keep-account">
        Google account
      </label>
      <div className="flex gap-2">
        <input id="keep-account" name="account" defaultValue={account} className="input" placeholder="0 or name@gmail.com" />
        <button type="submit" className="btn btn-sm" disabled={pending}>
          Save
        </button>
      </div>
      <p className="text-xs text-zinc-500">
        {state?.error ? <span className="text-red-600 dark:text-red-400">{state.error}</span> : state?.message ?? "0: the first one signed in in the automation Chrome, 1: the second … — or its address."}
      </p>
    </form>
  );
}
