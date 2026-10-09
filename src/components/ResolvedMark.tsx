/**
 * A message's done mark on its badge: a ✓ in a green circle when it's done (marked here, with
 * its todo, or resolved in GitLab), a faint dashed circle while it's open.
 */
export function ResolvedMark({ done, title }: { done: boolean; title?: string }) {
  const label = title ?? (done ? "erledigt" : "offen");
  return done ? (
    <svg viewBox="0 0 16 16" className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" role="img" aria-label={label}>
      <title>{label}</title>
      <circle cx="8" cy="8" r="7" fill="currentColor" />
      <path d="m4.75 8.25 2 2 4.5-4.75" fill="none" stroke="white" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg viewBox="0 0 16 16" className="size-3.5 shrink-0 text-zinc-400/80 dark:text-zinc-500" role="img" aria-label={label}>
      <title>{label}</title>
      <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.6 2" />
    </svg>
  );
}
