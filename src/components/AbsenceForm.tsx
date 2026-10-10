"use client";

import { useActionState } from "react";
import { createAbsenceAction } from "@/app/actions";
import type { ActionState } from "@/app/action-helpers";
import { ABSENCE_TYPES, ABSENCE_LABELS } from "@/lib/schedule-shared";
import { SubmitButton } from "./SubmitButton";

export function AbsenceForm({ defaultDate }: { defaultDate: string }) {
  const [state, action] = useActionState<ActionState, FormData>(createAbsenceAction, null);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-6">
      <div>
        <label className="label" htmlFor="startDate">From</label>
        <input id="startDate" name="startDate" type="date" defaultValue={defaultDate} className="input" required />
      </div>
      <div>
        <label className="label" htmlFor="endDate">To</label>
        <input id="endDate" name="endDate" type="date" defaultValue={defaultDate} className="input" />
      </div>
      <div>
        <label className="label" htmlFor="type">Type</label>
        <select id="type" name="type" className="input" defaultValue="vacation">
          {ABSENCE_TYPES.map((t) => (
            <option key={t} value={t}>{ABSENCE_LABELS[t]}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="hours">Hours/day</label>
        <input id="hours" name="hours" type="number" step="0.5" min="0" max="24" placeholder="full day" className="input num" />
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="note">Note</label>
        <input id="note" name="note" type="text" placeholder="optional" className="input" />
      </div>
      <div className="flex items-end sm:col-span-6">
        <SubmitButton className="btn btn-primary" pendingText="Adding…">Add absence</SubmitButton>
        {state?.error && <span className="ml-3 self-center text-sm text-red-600 dark:text-red-400">{state.error}</span>}
        {state?.ok && state.message && <span className="ml-3 self-center text-sm text-emerald-600 dark:text-emerald-400">{state.message}</span>}
      </div>
    </form>
  );
}
