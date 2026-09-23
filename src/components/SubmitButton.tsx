"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({
  children,
  pendingText = "Saving…",
  className = "btn btn-primary",
  confirm: confirmText,
  name,
  value,
}: {
  children: React.ReactNode;
  pendingText?: string;
  className?: string;
  /** If set, the browser asks this question before submitting. */
  confirm?: string;
  /** Optional form field this button contributes when it is the one clicked. */
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={className}
      name={name}
      value={value}
      onClick={(e) => {
        if (confirmText && !window.confirm(confirmText)) e.preventDefault();
      }}
    >
      {pending ? pendingText : children}
    </button>
  );
}
