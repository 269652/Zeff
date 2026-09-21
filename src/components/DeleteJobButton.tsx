"use client";

import { useActionState } from "react";
import { deleteJobAction } from "@/app/actions";
import { SubmitButton } from "./SubmitButton";

export function DeleteJobButton({ id, number }: { id: number; number: string }) {
  const [state, action] = useActionState(deleteJobAction, null);
  return (
    <form action={action} className="flex flex-col items-end gap-2">
      <input type="hidden" name="id" value={id} />
      <SubmitButton
        className="btn btn-danger"
        pendingText="Deleting…"
        confirm={`Delete job ${number}? This only works if no time is booked on it.`}
      >
        Delete job
      </SubmitButton>
      {state?.error && <p className="alert-error">{state.error}</p>}
    </form>
  );
}
