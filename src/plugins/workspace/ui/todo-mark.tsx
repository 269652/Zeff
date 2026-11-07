"use client";

import { useT } from "@/components/I18nProvider";
import type { TodoMark as Mark } from "../todo-marks";

/**
 * A row that flowed into todos (a mail, a note, a ticket): one todo — a coloured dot (amber: open, green: done); several — a badge
 * with a box and their number. Its tip says how many are open.
 */
export function TodoMark({ mark }: { mark: Mark | undefined }) {
  const t = useT();
  if (!mark?.n) return null;
  const done = mark.open === 0;
  const tip = mark.n === 1 ? `${done ? t("In a todo (done)") : t("In a todo")}: ${mark.text}` : t("In {n} todos, {open} open", { n: mark.n, open: mark.open });
  if (mark.n === 1)
    return <span role="img" className={`inline-block size-2 shrink-0 rounded-full ${done ? "bg-emerald-500" : "bg-amber-500"}`} title={tip} aria-label={tip} />;
  return (
    <span className={`inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 text-[11px] leading-4 font-medium tabular-nums ${done ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" : "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"}`} title={tip} aria-label={tip}>
      <span aria-hidden>☑</span>
      {mark.n}
    </span>
  );
}
