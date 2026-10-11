"use client";

import { useRef, useState, useTransition } from "react";
import type { ActionState } from "@/app/action-helpers";
import { TagsField } from "./TagsField";
import { useT } from "./I18nProvider";

export type JobFormDefaults = Partial<{
  number: string;
  name: string;
  customer: string;
  description: string;
  active: boolean;
  /** Default tags: added to every entry booked on the job. */
  tags: string[];
}>;

export function JobForm({
  action,
  defaults = {},
  submitLabel,
  mode = "create",
  allTags = [],
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  defaults?: JobFormDefaults;
  allTags?: string[];
  submitLabel?: string;
  mode?: "create" | "edit";
}) {
  const t = useT();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, setState] = useState<ActionState>(null);
  const [pending, startTransition] = useTransition();
  const [resetKey, setResetKey] = useState(0);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await action(null, fd);
      setState(result ?? null);
      if (result?.ok && mode === "create") {
        formRef.current?.reset();
        setResetKey((k) => k + 1);
      }
    });
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-6">
      <div className="sm:col-span-2">
        <label className="label" htmlFor="number">{t("Job number")}</label>
        <input id="number" name="number" type="text" placeholder="2026-0815" className="input font-mono" defaultValue={defaults.number} required />
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="name">{t("Name")}</label>
        <input id="name" name="name" type="text" placeholder={t("Website relaunch")} className="input" defaultValue={defaults.name} required />
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="customer">{t("Customer")}</label>
        <input id="customer" name="customer" type="text" placeholder="ACME GmbH" className="input" defaultValue={defaults.customer} />
      </div>
      <div className="sm:col-span-3">
        <label className="label" htmlFor="description">{t("Description")}</label>
        <input id="description" name="description" type="text" placeholder={t("Optional notes")} className="input" defaultValue={defaults.description} />
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="job-default-tags" title={t("Added to every entry booked on this job")}>{t("Default tags")}</label>
        <TagsField key={resetKey} id="job-default-tags" allTags={allTags} defaultValue={defaults.tags ?? []} />
      </div>
      <div className="flex items-end gap-3">
        {mode === "edit" && (
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input type="checkbox" name="active" defaultChecked={defaults.active ?? true} className="size-4 accent-indigo-600" />
            {t("Active")}
          </label>
        )}
        <button type="submit" className="btn btn-primary w-full" disabled={pending}>
          {pending ? t("Saving…") : (submitLabel ?? t("Create job"))}
        </button>
      </div>
      {state?.error && <p className="alert-error sm:col-span-6">{state.error}</p>}
      {state?.ok && state.message && <p className="alert-ok sm:col-span-6">{state.message}</p>}
    </form>
  );
}
