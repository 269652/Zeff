"use client";

import { useActionState } from "react";
import { saveTimoConfigAction } from "@/plugins/timo/server-actions";
import type { ActionState } from "@/app/action-helpers";
import type { TimoConfig } from "@/lib/timo";
import { SubmitButton } from "./SubmitButton";
import { useT } from "@/components/I18nProvider";

/** Configure the default TimO work day and which Zeff job counts as an absence. */
export function TimoConfigForm({ config, jobs }: { config: TimoConfig; jobs: { number: string; name: string }[] }) {
  const t = useT();
  const [state, action] = useActionState<ActionState, FormData>(saveTimoConfigAction, null);
  return (
    <form action={action} className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="startTime">{t("Start")}</label>
          <input id="startTime" name="startTime" type="time" className="input w-28" defaultValue={config.startTime} />
        </div>
        <div>
          <label className="label" htmlFor="workdayHours">{t("Hours/day")}</label>
          <input id="workdayHours" name="workdayHours" type="number" step="0.25" min="0.25" max="24" className="input num w-24" defaultValue={config.workdayHours} />
        </div>
        <div>
          <label className="label" htmlFor="breakMinutes">{t("Break (min)")}</label>
          <input id="breakMinutes" name="breakMinutes" type="number" step="5" min="0" max="240" className="input num w-24" defaultValue={config.breakMinutes} />
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-64">
          <label className="label" htmlFor="absenceJobNumber">{t("Absence job")}</label>
          <select id="absenceJobNumber" name="absenceJobNumber" className="input" defaultValue={config.absenceJobNumber ?? ""}>
            <option value="">{t("— none (all as working time) —")}</option>
            {jobs.map((j) => (
              <option key={j.number} value={j.number}>{j.number} — {j.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="absenceType">{t("TimO absence type")}</label>
          <input id="absenceType" name="absenceType" className="input w-40" defaultValue={config.absenceType ?? "Urlaub"} placeholder="Urlaub" />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <SubmitButton className="btn btn-sm" pendingText={t("Saving…")}>{t("Save TimO settings")}</SubmitButton>
        {state?.ok && <span className="text-sm text-emerald-600">{state.message}</span>}
        {state?.error && <span className="alert-error">{state.error}</span>}
      </div>
      <p className="text-xs text-zinc-400">
        {t("Entries on the")} <strong>{t("absence job")}</strong> {t("(or of type")} <strong>{t("Absence")}</strong>
        {t(") are booked in TimO's absence form as the")} <strong>{t("type")}</strong> {t("above (e.g.")}{" "}
        <code className="code">Urlaub</code>
        {t(", not Krank); everything else is recorded as working time (Kommen/Gehen).")}
      </p>
    </form>
  );
}
