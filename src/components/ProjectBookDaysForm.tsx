"use client";

import { useState, useTransition } from "react";
import type { ActionState } from "@/app/action-helpers";
import type { EntryTypeDef } from "@/lib/entry-types-shared";
import { useT } from "@/components/I18nProvider";

/** Book one entry per working day of a date range on a project (e.g. a 3-day training). */
export function ProjectBookDaysForm({
  action,
  defaultDescription,
  defaultFrom,
  types,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  defaultDescription: string;
  defaultFrom: string;
  types: EntryTypeDef[];
}) {
  const t = useT();
  const [state, setState] = useState<ActionState>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => setState((await action(null, fd)) ?? null));
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-6">
      <div>
        <label className="label" htmlFor="bd-from">{t("From")}</label>
        <input id="bd-from" name="from" type="date" className="input" defaultValue={defaultFrom} required />
      </div>
      <div>
        <label className="label" htmlFor="bd-to">{t("To")}</label>
        <input id="bd-to" name="to" type="date" className="input" defaultValue={defaultFrom} required />
      </div>
      <div>
        <label className="label" htmlFor="bd-hours">{t("Hours / day")}</label>
        <input
          id="bd-hours"
          name="hours"
          type="number"
          step="0.25"
          min="0.25"
          max="24"
          inputMode="decimal"
          placeholder={t("target")}
          title={t("Empty = each day's target from your schedule")}
          className="input num"
        />
      </div>
      <div>
        <label className="label" htmlFor="bd-type">{t("Type")}</label>
        <select id="bd-type" name="type" className="input" defaultValue="">
          <option value="">{t("Auto (rules)")}</option>
          {types.map((ty) => (
            <option key={ty.key} value={ty.key}>{ty.label}</option>
          ))}
        </select>
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="bd-description">{t("Description")}</label>
        <input id="bd-description" name="description" type="text" className="input" defaultValue={defaultDescription} required />
      </div>
      <label className="flex items-center gap-2 text-sm text-zinc-600 sm:col-span-5 dark:text-zinc-300">
        <input type="checkbox" name="fillUp" defaultChecked className="size-4 accent-indigo-600" />
        {t("Only fill what's missing to each day's target (days off and weekends are skipped either way)")}
      </label>
      <div>
        <button type="submit" className="btn btn-primary w-full" disabled={pending}>
          {pending ? t("Booking…") : t("Book days")}
        </button>
      </div>
      {state?.error && <p role="alert" className="alert-error sm:col-span-6">{state.error}</p>}
      {state?.ok && state.message && <p role="status" className="alert-ok sm:col-span-6">{state.message}</p>}
    </form>
  );
}
