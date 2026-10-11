/** A cross (problem), info (heads-up) or checkmark (all good) in a circle, drawn in the current text color. */
export function StatusIcon({ kind, className = "" }: { kind: "cross" | "info" | "check"; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`size-5 shrink-0 ${className}`}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      {kind === "cross" && <path d="M9 9l6 6M15 9l-6 6" />}
      {kind === "info" && <path d="M12 11v5M12 8h.01" />}
      {kind === "check" && <path d="M8.5 12.5l2.5 2.5 4.5-5" />}
    </svg>
  );
}
