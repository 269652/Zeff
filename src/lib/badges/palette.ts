/**
 * The colours a badge, a count pill or a dot can take (Settings → Badges) — one soft palette for all of them, each colour as whole
 * Tailwind class names (so Tailwind sees them): a pill, a paler pill (what is below a page in the Workspace tree), a dot, a mark (a
 * coloured sign inside a pill). Client-safe (pure).
 */

export const BADGE_COLORS = ["indigo", "sky", "teal", "emerald", "amber", "red", "rose", "violet", "zinc"] as const;
export type BadgeColor = (typeof BADGE_COLORS)[number];

/** A colour as stored (anything): a known one, else the fallback. */
export const parseColor = (raw: unknown, fallback: BadgeColor): BadgeColor => (typeof raw === "string" && (BADGE_COLORS as readonly string[]).includes(raw) ? (raw as BadgeColor) : fallback);

/** Each colour as a soft pill (segment). */
export const BADGE_TONES: Record<BadgeColor, string> = {
  indigo: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300",
  sky: "bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300",
  teal: "bg-teal-100 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300",
  emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  red: "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300",
  rose: "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300",
  violet: "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300",
  zinc: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

/** Each colour as a paler pill (in the Workspace tree: what is below a page). */
export const BADGE_TONES_DIM: Record<BadgeColor, string> = {
  indigo: "bg-indigo-50 text-indigo-500 dark:bg-indigo-950/30 dark:text-indigo-400",
  sky: "bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-400",
  teal: "bg-teal-50 text-teal-600 dark:bg-teal-950/30 dark:text-teal-400",
  emerald: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400",
  amber: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400",
  red: "bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400",
  rose: "bg-rose-50 text-rose-600 dark:bg-rose-950/30 dark:text-rose-400",
  violet: "bg-violet-50 text-violet-600 dark:bg-violet-950/30 dark:text-violet-400",
  zinc: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-400",
};

/** Each colour as a dot (the header's dots, the late mark in a tree pill). */
export const BADGE_DOTS: Record<BadgeColor, string> = {
  indigo: "bg-indigo-500",
  sky: "bg-sky-500",
  teal: "bg-teal-500",
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
  rose: "bg-rose-500",
  violet: "bg-violet-500",
  zinc: "bg-zinc-500",
};

/** Each colour as a dot that is lighter in dark mode (the Workspace tree's "changed" dot). */
export const BADGE_DOTS_SOFT: Record<BadgeColor, string> = {
  indigo: "bg-indigo-500 dark:bg-indigo-400",
  sky: "bg-sky-500 dark:bg-sky-400",
  teal: "bg-teal-500 dark:bg-teal-400",
  emerald: "bg-emerald-500 dark:bg-emerald-400",
  amber: "bg-amber-500 dark:bg-amber-400",
  red: "bg-red-500 dark:bg-red-400",
  rose: "bg-rose-500 dark:bg-rose-400",
  violet: "bg-violet-500 dark:bg-violet-400",
  zinc: "bg-zinc-500 dark:bg-zinc-400",
};

/** Each colour as a coloured sign in a pill (the ☐ of late todos). */
export const BADGE_MARKS: Record<BadgeColor, string> = {
  indigo: "text-indigo-600 dark:text-indigo-400",
  sky: "text-sky-600 dark:text-sky-400",
  teal: "text-teal-600 dark:text-teal-400",
  emerald: "text-emerald-600 dark:text-emerald-400",
  amber: "text-amber-600 dark:text-amber-400",
  red: "text-red-600 dark:text-red-400",
  rose: "text-rose-600 dark:text-rose-400",
  violet: "text-violet-600 dark:text-violet-400",
  zinc: "text-zinc-600 dark:text-zinc-400",
};
