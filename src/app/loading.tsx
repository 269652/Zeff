/** While a page loads (a tab switched): at once a sign that it's coming, instead of the old page standing still. */
export default function Loading() {
  return (
    <div className="flex items-center gap-2 py-10 text-sm text-zinc-500" role="status" aria-live="polite">
      <span className="inline-block size-4 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600 dark:border-indigo-900 dark:border-t-indigo-400" />
      Lädt …
    </div>
  );
}
