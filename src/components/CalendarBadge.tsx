"use client";

import { useT } from "@/components/I18nProvider";
import type { CalendarBrief } from "@/lib/calendar/brief";
import { formatDate } from "@/lib/format";
import { SourceCard } from "./SourceCard";

/** An appointment of a todo's calendar series — in its context: when, and the rule. */
export function CalendarBadge({ e, className = "", expanded = false, onToggle }: { e: CalendarBrief; className?: string; expanded?: boolean; onToggle?: () => void }) {
  const t = useT();
  return (
    <SourceCard
      tone="teal"
      icon={<span className="text-base leading-none">📅</span>}
      kind={e.rule ? t("Calendar series") : t("Appointment")}
      when={formatDate(e.start, { weekday: false })}
      title={e.title}
      sub={e.rule ?? e.calendar}
      expanded={expanded}
      onToggle={onToggle}
      toggleTitle={expanded ? t("Fold") : t("Show the appointment")}
      className={className}
    />
  );
}

/** The appointment in full, with a link to it in the calendar. */
export function CalendarDetails({ e }: { e: CalendarBrief }) {
  const t = useT();
  return (
    <div className="space-y-1 rounded-lg border border-zinc-200 bg-white p-3 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs text-zinc-500">{e.rule ? `${t("Calendar series")} · ${e.rule}` : t("Appointment")} · {e.calendar}</p>
      <p className="font-medium">{e.title}</p>
      <p className="text-xs text-zinc-500">{t("from {date}", { date: formatDate(e.start, { weekday: true, year: true }) })}</p>
      {e.todoId > 0 && (
        // eslint-disable-next-line @next/next/no-html-link-for-pages -- a redirect to the calendar's day
        <a href={`/api/todos/${e.todoId}/calendar`} className="text-xs text-indigo-600 hover:underline dark:text-indigo-400">
          {t("Show it in the calendar")} →
        </a>
      )}
    </div>
  );
}
