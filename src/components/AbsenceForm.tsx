"use client";

import { FormError } from "@/components/FormError";
import { useActionState } from "react";
import { createAbsenceAction } from "@/app/actions";
import type { ActionState } from "@/app/action-helpers";
import { ABSENCE_TYPES, absenceLabels } from "@/lib/schedule-shared";
import { SubmitButton } from "./SubmitButton";
import { useT } from "./I18nProvider";

export function AbsenceForm({ defaultDate }: { defaultDate: string }) {
  const t = useT();
  const [state, action] = useActionState<ActionState, FormData>(createAbsenceAction, null);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-6">
      <div>
        <label className="label" htmlFor="startDate">{t("From")}</label>
        <input id="startDate" name="startDate" type="date" defaultValue={defaultDate} className="input" required />
      </div>
      <div>
        <label className="label" htmlFor="endDate">{t("To")}</label>
        <input id="endDate" name="endDate" type="date" defaultValue={defaultDate} className="input" />
      </div>
      <div>
        <label className="label" htmlFor="type">{t("Type")}</label>
        <select id="type" name="type" className="input" defaultValue="vacation">
          {ABSENCE_TYPES.map((ty) => (
            <option key={ty} value={ty}>{absenceLabels(t)[ty]}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="hours">{t("Hours/day")}</label>
        <input id="hours" name="hours" type="number" step="0.5" min="0" max="24" placeholder={t("full day")} className="input num" />
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="note">{t("Note")}</label>
        <input id="note" name="note" type="text" placeholder={t("optional")} className="input" />
      </div>
      <div className="flex items-end sm:col-span-6">
        <SubmitButton className="btn btn-primary" pendingText={t("Adding…")}>{t("Add absence")}</SubmitButton>
        {state?.error && <FormError className="ml-3 self-center text-sm">{state.error}</FormError>}
        {state?.ok && state.message && <span className="ml-3 self-center text-sm text-emerald-600 dark:text-emerald-400">{state.message}</span>}
      </div>
    </form>
  );
}
