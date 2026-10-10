/** "Beta": a feature that works but may break — its warning on hover. */
export function BetaBadge({ warning }: { warning?: string }) {
  return (
    <span title={warning} className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-amber-800 uppercase dark:bg-amber-950 dark:text-amber-200">
      Beta
    </span>
  );
}

/** A beta feature's warning, as a box. */
export function BetaWarning({ warning, className = "" }: { warning: string; className?: string }) {
  return (
    <p className={`rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-100 ${className}`}>
      <span className="font-semibold">Beta — </span>
      {warning}
    </p>
  );
}
