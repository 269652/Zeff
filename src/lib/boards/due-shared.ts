/** A todo's deadline in words and colour — for server pages (Heute) and client badges alike. Client-safe. */
import { formatDate } from "@/lib/format";
import { translator, type T } from "@/lib/i18n/shared";

/** Days from today to a YYYY-MM-DD (negative: past). */
export const daysUntil = (due: string) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(`${due}T00:00:00`).getTime() - today.getTime()) / 864e5);
};

/** "due today", "due tomorrow", "overdue (2 days)", "due Fri 24 Oct" — in `t`'s language (English when none is given). */
export const dueText = (due: string, t: T = translator("en")) => {
  const d = daysUntil(due);
  if (d < 0) return -d === 1 ? t("overdue (1 day)") : t("overdue ({n} days)", { n: -d });
  if (d === 0) return t("due today");
  if (d === 1) return t("due tomorrow");
  return t("due {date}", { date: formatDate(due) });
};

export const dueTone = (due: string) => {
  const d = daysUntil(due);
  return d <= 0 ? "text-red-600 dark:text-red-400 font-medium" : d <= 3 ? "text-amber-600 dark:text-amber-400" : "text-zinc-500";
};
