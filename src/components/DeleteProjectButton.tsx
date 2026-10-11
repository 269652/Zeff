"use client";

import { useActionState } from "react";
import { deleteProjectAction } from "@/app/actions";
import { SubmitButton } from "./SubmitButton";
import { useT } from "@/components/I18nProvider";

export function DeleteProjectButton({ id, title, entryCount }: { id: number; title: string; entryCount: number }) {
  const t = useT();
  const [state, action] = useActionState(deleteProjectAction, null);
  return (
    <form action={action} className="flex flex-col items-end gap-2">
      <input type="hidden" name="id" value={id} />
      <SubmitButton
        className="btn btn-danger"
        pendingText={t("Deleting…")}
        confirm={
          entryCount > 0
            ? t("Delete project {title}? Its {n} entries stay booked on the job, just without the project.", {
                title,
                n: entryCount,
              })
            : t("Delete project {title}?", { title })
        }
      >
        {t("Delete project")}
      </SubmitButton>
      {state?.error && <p className="alert-error">{state.error}</p>}
    </form>
  );
}
