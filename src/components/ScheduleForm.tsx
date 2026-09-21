"use client";

import { useActionState } from "react";
import { saveScheduleAction, type ActionState } from "@/app/actions";
import { WEEKDAY_KEYS, WEEKDAY_LABELS } from "@/lib/schedule-shared";
import { SubmitButton } from "./SubmitButton";

export function ScheduleForm({ hours }: { hours: number[] }) {
  const [state, action] = useActionState<ActionState, FormData>(saveScheduleAction, null);
  return (
    <form action={action} className="space-y-3">
      <div className="grid grid-cols-4 gap-3 sm:grid-cols-7">
        {WEEKDAY_KEYS.map((k, i) => (
          <div key={k}>
            <label className="label" htmlFor={k}>{WEEKDAY_LABELS[i]}</label>
            <input
              id={k}
              name={k}
              type="number"
              step="0.5"
              min="0"
              max="24"
              defaultValue={hours[i]}
              className="input num"
            />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <SubmitButton className="btn btn-primary" pendingText="Saving…">Save working hours</SubmitButton>
        <span className="text-sm text-zinc-500">A day set to 0 counts as non-working (e.g. free Fridays).</span>
        {state?.error && <span className="text-sm text-red-600 dark:text-red-400">{state.error}</span>}
        {state?.ok && state.message && <span className="text-sm text-emerald-600 dark:text-emerald-400">{state.message}</span>}
      </div>
    </form>
  );
}
