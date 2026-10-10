/** A todo's deadline in words and colour — for server pages (Heute) and client badges alike. Client-safe. */
import { formatDate } from "@/lib/format";

/** Days from today to a YYYY-MM-DD (negative: past). */
export const daysUntil = (due: string) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(`${due}T00:00:00`).getTime() - today.getTime()) / 864e5);
};

/** "due today", "due tomorrow", "overdue (2 days)", "due Fri 24 Oct" */
export const dueText = (due: string) => {
  const d = daysUntil(due);
  if (d < 0) return `overdue (${-d === 1 ? "1 day" : `${-d} days`})`;
  if (d === 0) return "due today";
  if (d === 1) return "due tomorrow";
  return `due ${formatDate(due)}`;
};

export const dueTone = (due: string) => {
  const d = daysUntil(due);
  return d <= 0 ? "text-red-600 dark:text-red-400 font-medium" : d <= 3 ? "text-amber-600 dark:text-amber-400" : "text-zinc-500";
};
