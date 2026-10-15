"use client";

import { useActionState } from "react";
import { deleteJobAction } from "@/app/actions";
import { SubmitButton } from "./SubmitButton";
import { useT } from "@/components/I18nProvider";

export function DeleteJobButton({ id, number }: { id: number; number: string }) {
  const t = useT();
  const [state, action] = useActionState(deleteJobAction, null);
  return (
    <form action={action} className="flex flex-col items-end gap-2">
      <input type="hidden" name="id" value={id} />
      <SubmitButton
        className="btn btn-danger"
        pendingText={t("Deleting…")}
        confirm={t("Delete job {number}? This only works if no time is booked on it.", { number })}
      >
        {t("Delete job")}
      </SubmitButton>
      {state?.error && <p role="alert" className="alert-error">{state.error}</p>}
    </form>
  );
}
