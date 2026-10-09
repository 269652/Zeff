"use client";

import { useActionState } from "react";
import { deleteProjectAction } from "@/app/actions";
import { SubmitButton } from "./SubmitButton";

export function DeleteProjectButton({ id, title, entryCount }: { id: number; title: string; entryCount: number }) {
  const [state, action] = useActionState(deleteProjectAction, null);
  return (
    <form action={action} className="flex flex-col items-end gap-2">
      <input type="hidden" name="id" value={id} />
      <SubmitButton
        className="btn btn-danger"
        pendingText="Deleting…"
        confirm={
          entryCount > 0
            ? `Delete project ${title}? Its ${entryCount} entries stay booked on the job, just without the project.`
            : `Delete project ${title}?`
        }
      >
        Delete project
      </SubmitButton>
      {state?.error && <p className="alert-error">{state.error}</p>}
    </form>
  );
}
