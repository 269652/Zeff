const TONES = {
  /** Turns in the text colour around it (a button, a link). */
  current: "border-current border-t-transparent",
  /** Indigo on a light ring (something running). */
  indigo: "border-indigo-200 border-t-indigo-600 dark:border-indigo-900 dark:border-t-indigo-400",
};

/**
 * The turning ring: one primitive for "something is going on". The caller gives the size, display
 * and spacing in `className` ("inline-block size-3 align-[-1px]"); with a `label` it is announced
 * (role status), without it it is decoration.
 */
export function Spinner({ tone = "current", label, className = "" }: { tone?: keyof typeof TONES; label?: string; className?: string }) {
  return (
    <span
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      title={label}
      className={`animate-spin rounded-full border-2 ${TONES[tone]} ${className}`}
    />
  );
}

/** The "Loading…" line of a list that fills in (a menu, a dropdown): one <li>, same padding everywhere. */
export function LoadingRow({ children }: { children: React.ReactNode }) {
  return <li className="px-3 py-3 text-sm text-zinc-500">{children}</li>;
}
