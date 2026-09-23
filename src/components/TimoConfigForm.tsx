"use client";

import { useActionState } from "react";
import { saveTimoConfigAction, type ActionState } from "@/app/actions";
import type { TimoConfig } from "@/lib/timo";
import { SubmitButton } from "./SubmitButton";

/** Configure the default TimO work day (start, hours, break). */
export function TimoConfigForm({ config }: { config: TimoConfig }) {
  const [state, action] = useActionState<ActionState, FormData>(saveTimoConfigAction, null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <div>
        <label className="label" htmlFor="startTime">Start</label>
        <input id="startTime" name="startTime" type="time" className="input w-28" defaultValue={config.startTime} />
      </div>
      <div>
        <label className="label" htmlFor="workdayHours">Hours/day</label>
        <input id="workdayHours" name="workdayHours" type="number" step="0.25" min="0.25" max="24" className="input num w-24" defaultValue={config.workdayHours} />
      </div>
      <div>
        <label className="label" htmlFor="breakMinutes">Break (min)</label>
        <input id="breakMinutes" name="breakMinutes" type="number" step="5" min="0" max="240" className="input num w-24" defaultValue={config.breakMinutes} />
      </div>
      <SubmitButton className="btn btn-sm" pendingText="Saving…">Save work day</SubmitButton>
      {state?.ok && <span className="text-sm text-emerald-600">{state.message}</span>}
      {state?.error && <span className="alert-error">{state.error}</span>}
    </form>
  );
}
