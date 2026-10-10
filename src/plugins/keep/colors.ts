/** Keep's note colours, softened (static class names — Tailwind only sees what's written out). Client-safe. */
export const KEEP_COLORS: Record<string, string> = {
  red: "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30",
  orange: "border-orange-200 bg-orange-50 dark:border-orange-900 dark:bg-orange-950/30",
  yellow: "border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950/30",
  green: "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30",
  teal: "border-teal-200 bg-teal-50 dark:border-teal-900 dark:bg-teal-950/30",
  blue: "border-sky-200 bg-sky-50 dark:border-sky-900 dark:bg-sky-950/30",
  cerulean: "border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30",
  purple: "border-purple-200 bg-purple-50 dark:border-purple-900 dark:bg-purple-950/30",
  pink: "border-pink-200 bg-pink-50 dark:border-pink-900 dark:bg-pink-950/30",
  brown: "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30",
  gray: "border-zinc-300 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800/60",
};

/** The colour swatches (for picking one). */
export const KEEP_SWATCH: Record<string, string> = {
  red: "bg-red-300",
  orange: "bg-orange-300",
  yellow: "bg-yellow-300",
  green: "bg-green-300",
  teal: "bg-teal-300",
  blue: "bg-sky-300",
  cerulean: "bg-blue-300",
  purple: "bg-purple-300",
  pink: "bg-pink-300",
  brown: "bg-amber-400",
  gray: "bg-zinc-300",
};

export const isKeepColor = (c: string) => c in KEEP_COLORS;
export const keepNoteClass = (c: string | null) => (c ? (KEEP_COLORS[c] ?? "") : "");
