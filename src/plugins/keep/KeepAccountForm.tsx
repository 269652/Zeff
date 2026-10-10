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
        Google-Konto
      </label>
      <div className="flex gap-2">
        <input id="keep-account" name="account" defaultValue={account} className="input" placeholder="0 oder name@gmail.com" />
        <button type="submit" className="btn btn-sm" disabled={pending}>
          Sichern
        </button>
      </div>
      <p className="text-xs text-zinc-500">
        {state?.error ? <span className="text-red-600 dark:text-red-400">{state.error}</span> : state?.message ?? "0: das erste im Automations-Chrome angemeldete, 1: das zweite … — oder seine Adresse."}
      </p>
    </form>
  );
}
