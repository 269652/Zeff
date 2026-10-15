"use client";

import { useRef, useState, useTransition } from "react";
import type { ActionState } from "@/app/action-helpers";
import { TagsField } from "./TagsField";
import { useT } from "@/components/I18nProvider";

export type ProjectFormDefaults = Partial<{
  title: string;
  description: string;
  customer: string;
  jobNumber: string;
  startDate: string;
  endDate: string;
  active: boolean;
  /** Default tags: added to every entry booked on the project. */
  tags: string[];
}>;

export function ProjectForm({
  action,
  jobs,
  defaults = {},
  submitLabel,
  mode = "create",
  entryCount = 0,
  allTags = [],
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  jobs: { number: string; name: string }[];
  defaults?: ProjectFormDefaults;
  submitLabel?: string;
  mode?: "create" | "edit";
  /** Entries the project has — they move along when its job changes. */
  entryCount?: number;
  allTags?: string[];
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
        <label className="label" htmlFor="title">{t("Title")}</label>
        <input id="title" name="title" type="text" placeholder={t("TYPO3 Training")} className="input" defaultValue={defaults.title} required />
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="jobNumber">{t("Job")}</label>
        <select id="jobNumber" name="jobNumber" className="input" defaultValue={defaults.jobNumber ?? ""}>
          <option value="">— {t("No job yet")} —</option>
          {jobs.map((j) => (
            <option key={j.number} value={j.number}>
              {j.number} — {j.name}
            </option>
          ))}
        </select>
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="customer">{t("Customer")}</label>
        <input id="customer" name="customer" type="text" placeholder={t("Optional")} className="input" defaultValue={defaults.customer} />
      </div>
      <div className="sm:col-span-4">
        <label className="label" htmlFor="description">{t("Description")}</label>
        <input id="description" name="description" type="text" placeholder={t("Optional notes")} className="input" defaultValue={defaults.description} />
      </div>
      <div>
        <label className="label" htmlFor="startDate">{t("Start")}</label>
        <input id="startDate" name="startDate" type="date" className="input" defaultValue={defaults.startDate} />
      </div>
      <div>
        <label className="label" htmlFor="endDate">{t("End")}</label>
        <input id="endDate" name="endDate" type="date" className="input" defaultValue={defaults.endDate} />
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="project-default-tags" title={t("Added to every entry booked on this project")}>{t("Default tags")}</label>
        <TagsField key={resetKey} id="project-default-tags" allTags={allTags} defaultValue={defaults.tags ?? []} />
      </div>
      <p className="text-xs text-zinc-500 sm:col-span-3 sm:self-center">
        {t("Entries booked on the project land on its job.")}{" "}
        {mode === "edit" && entryCount > 0
          ? entryCount === 1
            ? t("Changing the job moves all 1 entry along.")
            : t("Changing the job moves all {n} entries along.", { n: entryCount })
          : t("Without a job they wait under “No job yet” (skipped by the Chrono export) until you set one.")}
      </p>
      <div className="flex items-end gap-3">
        {mode === "edit" && (
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input type="checkbox" name="active" defaultChecked={defaults.active ?? true} className="size-4 accent-indigo-600" />
            {t("Active")}
          </label>
        )}
        <button type="submit" className="btn btn-primary w-full" disabled={pending}>
          {pending ? t("Saving…") : (submitLabel ?? t("Create project"))}
        </button>
      </div>
      {state?.error && <p role="alert" className="alert-error sm:col-span-6">{state.error}</p>}
      {state?.ok && state.message && <p role="status" className="alert-ok sm:col-span-6">{state.message}</p>}
    </form>
  );
}
