"use client";

import { useActionState } from "react";
import { saveTimoConfigAction } from "@/plugins/timo/server-actions";
import type { ActionState } from "@/app/action-helpers";
import type { TimoConfig } from "@/lib/timo";
import { SubmitButton } from "./SubmitButton";

/** Configure the default TimO work day and which Zeff job counts as an absence. */
export function TimoConfigForm({ config, jobs }: { config: TimoConfig; jobs: { number: string; name: string }[] }) {
  const [state, action] = useActionState<ActionState, FormData>(saveTimoConfigAction, null);
  return (
    <form action={action} className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
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
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-64">
          <label className="label" htmlFor="absenceJobNumber">Absence job</label>
          <select id="absenceJobNumber" name="absenceJobNumber" className="input" defaultValue={config.absenceJobNumber ?? ""}>
            <option value="">— none (all as working time) —</option>
            {jobs.map((j) => (
              <option key={j.number} value={j.number}>{j.number} — {j.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="absenceType">TimO absence type</label>
          <input id="absenceType" name="absenceType" className="input w-40" defaultValue={config.absenceType ?? "Urlaub"} placeholder="Urlaub" />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <SubmitButton className="btn btn-sm" pendingText="Saving…">Save TimO settings</SubmitButton>
        {state?.ok && <span className="text-sm text-emerald-600">{state.message}</span>}
        {state?.error && <span className="alert-error">{state.error}</span>}
      </div>
      <p className="text-xs text-zinc-400">
        Entries on the <strong>absence job</strong> (or of type <strong>Absence</strong>) are booked in TimO&apos;s
        absence form as the{" "}
        <strong>type</strong> above (e.g. <code className="code">Urlaub</code>, not Krank); everything else is recorded as
        working time (Kommen/Gehen).
      </p>
    </form>
  );
}
