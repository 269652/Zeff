"use client";

import { useFormStatus } from "react-dom";
import { useT } from "@/components/I18nProvider";

export function SubmitButton({
  children,
  pendingText,
  className = "btn btn-primary",
  confirm: confirmText,
  name,
  value,
  pending: pendingProp,
  title,
  label,
}: {
  children: React.ReactNode;
  pendingText?: string;
  className?: string;
  /** If set, the browser asks this question before submitting. */
  confirm?: string;
  /** Optional form field this button contributes when it is the one clicked. */
  name?: string;
  value?: string;
  /** Pending state for forms submitted via onSubmit (useFormStatus only sees `action` submissions). */
  pending?: boolean;
  /** Tooltip. */
  title?: string;
  /** Accessible name, for a button that shows just an icon. */
  label?: string;
}) {
  const t = useT();
  const status = useFormStatus();
  const pending = pendingProp ?? status.pending;
  return (
    <button
      type="submit"
      disabled={pending}
      className={className}
      name={name}
      value={value}
      title={title}
      aria-label={label}
      onClick={(e) => {
        if (confirmText && !window.confirm(confirmText)) e.preventDefault();
      }}
    >
      {pending ? (pendingText ?? t("Saving…")) : children}
    </button>
  );
}
