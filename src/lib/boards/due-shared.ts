/** A todo's deadline in words and colour — for server pages (Heute) and client badges alike. Client-safe. */

/** Days from today to a YYYY-MM-DD (negative: past). */
export const daysUntil = (due: string) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(`${due}T00:00:00`).getTime() - today.getTime()) / 864e5);
};

/** "heute", "morgen", "überfällig (2 T.)", "Fr., 24.10." */
export const dueText = (due: string) => {
  const d = daysUntil(due);
  if (d < 0) return `überfällig (${-d} T.)`;
  if (d === 0) return "heute fällig";
  if (d === 1) return "morgen fällig";
  return `fällig ${new Date(`${due}T00:00:00`).toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "numeric" })}`;
};

export const dueTone = (due: string) => {
  const d = daysUntil(due);
  return d <= 0 ? "text-red-600 dark:text-red-400 font-medium" : d <= 3 ? "text-amber-600 dark:text-amber-400" : "text-zinc-500";
};
