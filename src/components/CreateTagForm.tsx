"use client";

import { useActionState } from "react";
import { createTagAction, type ActionState } from "@/app/actions";
import { SubmitButton } from "./SubmitButton";

export function CreateTagForm() {
  const [state, action] = useActionState<ActionState, FormData>(createTagAction, null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <div>
        <label className="label" htmlFor="name">New tag</label>
        <input id="name" name="name" className="input" placeholder="regression" required />
      </div>
      <SubmitButton className="btn btn-primary" pendingText="Adding…">Add tag</SubmitButton>
      {state?.error && <span className="self-center text-sm text-red-600 dark:text-red-400">{state.error}</span>}
      {state?.ok && state.message && <span className="self-center text-sm text-emerald-600 dark:text-emerald-400">{state.message}</span>}
    </form>
  );
}
