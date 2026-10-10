"use client";

import { useActionState } from "react";
import { pasteEventsAction } from "@/plugins/outlook-calendar/server-actions";
import type { ActionState } from "@/app/action-helpers";
import { SubmitButton } from "./SubmitButton";

export function PasteEventsForm() {
  const [state, action] = useActionState<ActionState, FormData>(pasteEventsAction, null);
  return (
    <form action={action} className="space-y-2">
      <textarea
        name="json"
        rows={4}
        className="input font-mono text-xs"
        placeholder='Paste the JSON from the "copy" bookmarklet here, e.g. {"events":[…]}'
      />
      <div className="flex items-center gap-3">
        <SubmitButton className="btn" pendingText="Loading…">Load pasted meetings</SubmitButton>
        {state?.error && <span className="text-sm text-red-600 dark:text-red-400">{state.error}</span>}
        {state?.ok && state.message && <span className="text-sm text-emerald-600 dark:text-emerald-400">{state.message}</span>}
      </div>
    </form>
  );
}
