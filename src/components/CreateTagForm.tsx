"use client";

import { FormError } from "@/components/FormError";
import { useActionState } from "react";
import { createTagAction } from "@/app/actions";
import type { ActionState } from "@/app/action-helpers";
import { SubmitButton } from "./SubmitButton";
import { useT } from "./I18nProvider";

export function CreateTagForm() {
  const t = useT();
  const [state, action] = useActionState<ActionState, FormData>(createTagAction, null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <div>
        <label className="label" htmlFor="name">{t("New tag")}</label>
        <input id="name" name="name" className="input" placeholder={t("regression")} required />
      </div>
      <SubmitButton className="btn btn-primary" pendingText={t("Adding…")}>{t("Add tag")}</SubmitButton>
      {state?.error && <FormError className="self-center text-sm">{state.error}</FormError>}
      {state?.ok && state.message && <span className="self-center text-sm text-emerald-600 dark:text-emerald-400">{state.message}</span>}
    </form>
  );
}
