/** While a page loads (a tab switched): at once, in the middle of where it will be, a calm sign that it's coming. */
export default function Loading() {
  return (
    <div className="flex h-[calc(100dvh-7rem)] flex-col items-center justify-center gap-3" role="status" aria-live="polite">
      <svg viewBox="0 0 48 48" className="size-10 animate-spin text-indigo-600 [animation-duration:900ms] dark:text-indigo-400" aria-hidden>
        <circle cx="24" cy="24" r="20" fill="none" stroke="currentColor" strokeWidth="4" className="opacity-15" />
        <circle cx="24" cy="24" r="20" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeDasharray="40 126" />
      </svg>
      <span className="text-xs font-medium tracking-wide text-zinc-400 uppercase">Lädt</span>
    </div>
  );
}
