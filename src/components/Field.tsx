"use client";

import { useId, type ReactNode } from "react";
import { FormError } from "./FormError";

/** What a control needs to belong to its field: its id (the label's target), its description and its error state. */
export type FieldControlProps = { id: string; "aria-describedby"?: string; "aria-invalid"?: true; "aria-required"?: true };

/**
 * A labelled form field: the visible label tied to the control (not a placeholder), a hint and an
 * error that the control is described by (so a screen reader reads them with it), and `required`
 * marked in words as well as by the control. The control comes as a function so it takes the props:
 *
 *   <Field label="Client ID" hint="…" error={error}>{(p) => <input className="input" {...p} />}</Field>
 */
export function Field({ label, hint, error, required, className = "", children }: { label: string; hint?: ReactNode; error?: string | null; required?: boolean; className?: string; children: (props: FieldControlProps) => ReactNode }) {
  const uid = useId();
  const hintId = hint ? `${uid}-hint` : undefined;
  const errorId = error ? `${uid}-error` : undefined;
  const describedby = [errorId, hintId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={className}>
      <label className="label" htmlFor={uid}>
        {label}
        {required && <span aria-hidden> *</span>}
      </label>
      {children({ id: uid, "aria-describedby": describedby, ...(error ? { "aria-invalid": true as const } : {}), ...(required ? { "aria-required": true as const } : {}) })}
      {hint && (
        <p id={hintId} className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
          {hint}
        </p>
      )}
      {error && (
        <FormError id={errorId} as="p" className="mt-1 text-xs">
          {error}
        </FormError>
      )}
    </div>
  );
}
